/**
 * Archer Harness — 受限子 Agent 委托 Provider
 *
 * 将同步子任务暴露为 Camp 标准 Tool（`delegate`），通过 `scopeCamp` 裁剪子 Agent 能力视图，
 * 并为子会话分配独立的 Archer 实例与独立 AgentJournal，父子之间仅通过最终结果交互。
 */

import type {
  AgentDraft,
  AgentEvent,
  AgentJournal,
  Camp,
  CapabilityRef,
  Contract,
  JsonObject,
  Provider,
} from '@archer/contracts';
import { ArcherError } from '@archer/contracts';
import { JOURNAL, provider, scopeCamp, tool, type CampScopePolicy } from '@archer/camp';
import { createArcher } from './container.js';

export interface SubagentProviderOptions {
  /** Provider ID，默认 `'subagent'` */
  id?: string;
  /** 父级 Camp 或延迟获取函数；子 Agent 仅能访问裁剪后的视图 */
  camp: Camp | (() => Camp);
  /** 可选：显式指定子 Agent 使用的推理能力引用 */
  inference?: CapabilityRef;
  /** 可选：显式指定子 Agent 使用的持久化日志能力引用；缺省为每次调用独立的内存日志 */
  journal?: CapabilityRef;
  /** 能力裁剪策略；默认 `readOnlyTools: true` 并禁止递归调用自身 */
  scope?: CampScopePolicy;
  /** 子 Agent 默认系统指令 */
  instructions?: string;
  /** 单次子任务默认最大推理步数，默认 12 */
  maxInferenceSteps?: number;
  /** 工具模型描述 */
  description?: string;
  /** 能力执行分类；默认 `'read'`，允许写能力时应设为 `'write'` */
  execution?: 'read' | 'write';
}

function createIsolatedMemoryJournal(): AgentJournal {
  const store = new Map<string, AgentEvent[]>();
  return {
    async ids() {
      return [...store.keys()];
    },
    async read(agentId) {
      return [...(store.get(agentId) ?? [])];
    },
    async append({ agentId, expectedSeq, drafts }) {
      const existing = store.get(agentId) ?? [];
      if (existing.length !== expectedSeq) {
        throw new ArcherError('COMMIT_UNKNOWN', `Subagent journal seq mismatch: expected ${expectedSeq}, actual ${existing.length}`);
      }
      const turnSeqs = new Map<string, number>();
      for (const item of existing) {
        if (item.fact.scope === 'turn') {
          turnSeqs.set(item.fact.turnId, item.fact.turnSeq);
        }
      }
      const committed: AgentEvent[] = [];
      let seq = expectedSeq;
      for (const draft of drafts as readonly AgentDraft[]) {
        seq += 1;
        const fact =
          draft.scope === 'agent'
            ? draft
            : {
                ...draft,
                turnSeq: (() => {
                  const next = (turnSeqs.get(draft.turnId) ?? 0) + 1;
                  turnSeqs.set(draft.turnId, next);
                  return next;
                })(),
              };
        const event: AgentEvent = {
          id: `${agentId}:${seq}`,
          agentId,
          seq,
          ts: Date.now(),
          fact,
        };
        existing.push(event);
        committed.push(event);
      }
      store.set(agentId, existing);
      return committed;
    },
  };
}

function withIsolatedJournal(base: Camp, journal: AgentJournal): { camp: Camp; journalRef: CapabilityRef } {
  const journalRef: CapabilityRef = {
    providerId: '__subagent_journal__',
    capabilityId: 'journal',
    contractId: JOURNAL.id,
    revision: 'isolated-memory',
  };
  const camp: Camp = {
    get signal() {
      return base.signal;
    },
    providers() {
      return base.providers();
    },
    list<I, M extends object>(contract: Contract<I, M>) {
      if (contract.id === JOURNAL.id) {
        return [{ ref: journalRef, metadata: { description: 'Isolated subagent journal.' } }] as never;
      }
      return base.list(contract);
    },
    resolve(ref, contract) {
      if (
        contract.id === JOURNAL.id &&
        ref.providerId === journalRef.providerId &&
        ref.capabilityId === journalRef.capabilityId &&
        ref.revision === journalRef.revision
      ) {
        return journal as never;
      }
      return base.resolve(ref, contract);
    },
    acquire() {
      return base.acquire();
    },
    refreshProvider(providerId) {
      return base.refreshProvider(providerId);
    },
    close() {
      return base.close();
    },
  };
  return { camp, journalRef };
}

/** 创建可挂载到 Camp 的同步子 Agent 委托 Provider。 */
export function createSubagentProvider(options: SubagentProviderOptions): Provider {
  const providerId = options.id ?? 'subagent';
  const readOnlyTools = options.scope?.readOnlyTools ?? true;
  const execution = options.execution ?? (readOnlyTools ? 'read' : 'write');
  let counter = 0;

  return provider(
    providerId,
    {
      delegate: tool({
        description:
          options.description ??
          'Delegate a focused subtask to an isolated sub-agent with restricted capabilities and return its final answer.',
        summary: '派发隔离的子 Agent 执行聚焦子任务。',
        inputSchema: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'Clear instructions for the sub-agent.' },
            instructions: { type: 'string', description: 'Optional system persona override.' },
          },
          required: ['task'],
          additionalProperties: false,
        },
        execution,
        invoke: async (input, context) => {
          const payload = (input ?? {}) as { task?: unknown; instructions?: unknown };
          if (typeof payload.task !== 'string' || !payload.task.trim()) {
            throw new ArcherError('INVALID_ARGUMENT', 'Subagent task must be a non-empty string.');
          }
          const customInstructions =
            typeof payload.instructions === 'string' && payload.instructions.trim()
              ? payload.instructions.trim()
              : undefined;

          const parentCamp = typeof options.camp === 'function' ? options.camp() : options.camp;
          const deny = new Set(options.scope?.denyCapabilities ?? []);
          deny.add(`${providerId}:delegate`);
          const scopedCamp = scopeCamp(parentCamp, {
            ...options.scope,
            readOnlyTools,
            denyCapabilities: [...deny],
          });

          const isolated = options.journal
            ? { camp: scopedCamp, journalRef: options.journal }
            : withIsolatedJournal(scopedCamp, createIsolatedMemoryJournal());
          const childArcher = createArcher({
            camp: isolated.camp,
            journal: isolated.journalRef,
            ...(options.inference ? { inference: options.inference } : {}),
            preparations: [],
          });

          counter += 1;
          const safeTurn = (context.call?.turnId ?? 'root').replace(/[^A-Za-z0-9_.-]/g, '-');
          const childId = `${safeTurn}-sub-${counter}`.slice(0, 128);
          const childWorkspace = context.workspace
            ? readOnlyTools
              ? { ...context.workspace, access: 'read' as const }
              : context.workspace
            : undefined;

          await childArcher.start();
          try {
            const childAgent = await childArcher.agents.create({
              id: childId,
              instructions:
                customInstructions ??
                options.instructions ??
                'You are a focused sub-agent. Complete the delegated task concisely using only your available tools.',
              ...(childWorkspace ? { workspace: childWorkspace } : {}),
            });
            await childAgent.prompt(payload.task, {
              signal: context.signal,
              allowShell: false,
              limits: { maxInferenceSteps: options.maxInferenceSteps ?? 12 },
            });
            const snapshot = await childAgent.getState();
            const reply =
              [...snapshot.messages].reverse().find((m) => m.role === 'assistant')?.content ?? '';
            return {
              agentId: childId,
              output: reply,
            } satisfies JsonObject;
          } finally {
            await childArcher.stop({ timeoutMs: 2_000 }).catch(() => undefined);
          }
        },
      }),
    },
    {
      identity: {
        name: '子 Agent 委托',
        description: '通过裁剪后的只读能力视图派发隔离的子任务，并返回最终结果。',
        provider: providerId,
        readOnlyTools,
      },
    },
  );
}
