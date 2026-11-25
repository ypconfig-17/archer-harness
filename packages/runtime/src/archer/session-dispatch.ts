/**
 * Archer Harness — Effect 分发、命令审批与管线执行桥接
 *
 * 负责在锁外调用能力实现，并通过唯一串行提交端口记录 started、模型请求、摘要与收束结果。
 */

import { channel } from 'node:diagnostics_channel';
import { createHash, randomBytes } from 'node:crypto';
import type {
  Camp,
  CapabilityRef,
  InferEffect,
  InferResult,
  InferenceChunk,
  KernelError,
} from '@archer/contracts';
import {
  ArcherError,
  KernelErrorSchema,
  assertJsonValue,
  canonicalJson,
  freezeSnapshot,
  validateInput,
} from '@archer/contracts';
import { INFERENCE, INFERENCE_PREPARE } from '@archer/camp';
import {
  DraftBuilder,
  type SessionCommand,
  type SessionContext,
  type SessionDecision,
  type SessionEffect,
  type SessionEffectOutcome,
  type SessionState,
  type SessionTurn,
} from '@archer/agent';
import { ExecutionCommitError, type EffectHandler } from '@archer/handler';
import { workspaceFiles } from '@archer/providers';
import { committedHistory } from './history.js';
import { automaticallyApproved } from '../execution/command-approval.js';
import {
  beginEffectDecision,
  effectOutcomeDecision,
  suspendEffectDecision,
} from '../execution/session-step.js';
import { resolveCall } from '../execution/targets.js';
import {
  SUSPEND_TTL_MS,
  type DispatchPlan,
  type InFlight,
  type Preflight,
} from './session-runtime-types.js';

export interface DispatchHost {
  readonly id: string;
  withLock<T>(task: () => Promise<T>): Promise<T>;
  commit(decision: SessionDecision): Promise<unknown>;
  getState(): SessionState;
  getCamp(): Camp;
  getInference(): CapabilityRef;
  getClock(): () => number;
  getDecisionContext(): SessionContext;
  getEffectPipeline(): EffectHandler;
  isAdmitted(): boolean;
  isStopping(): boolean;
  hasFault(): boolean;
  getInFlight(): Map<string, InFlight>;
  getBlocked(): Set<string>;
  locateEffect(effectId: string): { turn: SessionTurn; effect: SessionEffect } | null;
  publishProgress(
    plan: DispatchPlan,
    chunk: InferenceChunk,
    phase?: 'generating' | 'settled' | 'interrupted',
  ): void;
  getLatestProgress(): { effectId: string; phase: string; content: string; reasoning?: string } | null;
  suspend(effectId: string): Promise<void>;
  maybeConsumeQueue(): Promise<void>;
}

export async function dispatchEffect(
  host: DispatchHost,
  effectId: string,
): Promise<SessionCommand[]> {
  const plan = await host.withLock(async () => prepareDispatch(host, effectId));
  if (!plan) return [];
  try {
    if (plan.effect.type === 'CALL' && plan.preflight) {
      try {
        validateInput(plan.preflight.metadata.inputSchema, plan.effect.input);
      } catch (error) {
        const parsed = KernelErrorSchema.safeParse(error);
        plan.preflightError = parsed.success
          ? parsed.data
          : {
              code: 'PROVIDER_ERROR',
              message: error instanceof Error ? error.message : String(error),
            };
      }
      if (!(await approveCommand(host, plan))) return [];
    }
    await performPlan(host, plan);
    await host.maybeConsumeQueue();
    return plan.commands;
  } finally {
    const latestProgress = host.getLatestProgress();
    if (latestProgress?.effectId === plan.effectId && latestProgress.phase === 'generating') {
      const effect = host.locateEffect(plan.effectId)?.effect;
      host.publishProgress(
        plan,
        latestProgress,
        effect?.status === 'completed' ? 'settled' : 'interrupted',
      );
    }
    plan.preflight?.release();
    host.getInFlight().delete(effectId);
  }
}

/** 能力已固定到本次执行；这里只检查当前事实并提交命令等待。 */
async function approveCommand(host: DispatchHost, plan: DispatchPlan): Promise<boolean> {
  return host.withLock(async () => {
    const located = host.locateEffect(plan.effectId);
    if (
      !located ||
      host.isStopping() ||
      host.hasFault() ||
      located.turn.cancel ||
      !['created', 'resumed'].includes(located.effect.status)
    ) {
      return false;
    }
    const { turn, effect } = located;
    if (
      effect.effect.type === 'CALL' &&
      !plan.preflightError &&
      plan.preflight?.metadata.execution === 'shell' &&
      turn.allowShell &&
      !effect.commandApproved &&
      turn.commandMode !== 'full' &&
      !(
        turn.commandMode === 'auto' &&
        automaticallyApproved(effect.effect.input, process.platform)
      )
    ) {
      const now = host.getClock()();
      const hash = createHash('sha256').update(randomBytes(32)).digest('hex');
      const decision = suspendEffectDecision(
        host.getState(),
        plan.effectId,
        hash,
        now + SUSPEND_TTL_MS,
        { now },
      );
      if (!decision.ok) throw decision.error;
      await host.commit(decision.value);
      return false;
    }
    plan.authorizationRevision = host.getState().executionRevision;
    return true;
  });
}

function prepareDispatch(host: DispatchHost, effectId: string): DispatchPlan | null {
  const state = host.getState();
  if (!host.isAdmitted() || host.hasFault() || host.isStopping() || state.removed) return null;
  if (host.getInFlight().has(effectId)) return null;

  const located = host.locateEffect(effectId);
  if (!located) return null;
  const { turn, effect } = located;
  if (turn.turnId !== state.activeTurnId) return null;
  if (effect.status !== 'created' && effect.status !== 'resumed') return null;

  const camp = host.getCamp();
  let preflight: Preflight | null = null;
  let preflightError: KernelError | null = null;
  try {
    if (effect.effect.type === 'CALL') {
      const target = resolveCall(camp, effect.effect);
      preflight = { ...target, release: camp.acquire() };
    } else if (effect.effect.type === 'INFER') {
      camp.resolve(effect.effect.target, INFERENCE);
    }
  } catch (error) {
    if (error instanceof ArcherError && error.code === 'CAPABILITY_UNAVAILABLE') {
      host.getBlocked().add(effectId);
      return null;
    }
    preflightError = {
      code: 'PROVIDER_ERROR',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  host.getBlocked().delete(effectId);

  const controller = new AbortController();
  host.getInFlight().set(effectId, { controller });

  return {
    effectId,
    authorizationRevision: state.executionRevision,
    turnId: turn.turnId,
    effect: effect.effect,
    preflight,
    preflightError,
    controller,
    commands: [],
  };
}

/** 包装器通过此端口在串行边界内提交开始与结果，始终只有一个日志写入方。 */
function executionJournal(host: DispatchHost, plan: DispatchPlan) {
  return {
    begin: () =>
      host.withLock(async () => {
        const state = host.getState();
        if (!host.isAdmitted() || host.isStopping() || host.hasFault() || state.removed) {
          return false;
        }
        // 授权在准入与开始提交之间改变时，重新准入尚未开始的操作。
        if (plan.authorizationRevision !== state.executionRevision) {
          plan.commands.push({ type: 'dispatch_effect', effectId: plan.effectId });
          return false;
        }
        const decision = beginEffectDecision(state, plan.effectId, host.getDecisionContext());
        if (!decision.ok) {
          if (decision.error.code === 'CONFLICT') return false;
          throw decision.error;
        }
        await host.commit(decision.value);
        return true;
      }),
    complete: (outcome: SessionEffectOutcome) =>
      host.withLock(async () => {
        if (host.hasFault()) return;
        const decision = effectOutcomeDecision(
          host.getState(),
          plan.effectId,
          outcome,
          host.getDecisionContext(),
        );
        if (!decision.ok) {
          if (decision.error.code === 'CONFLICT') return;
          throw decision.error;
        }
        await host.commit(decision.value);
        plan.commands.push(...decision.value.commands);
      }),
    suspend: () => host.suspend(plan.effectId),
  };
}

/** 每个真实模型请求先提交实际输入，确认响应后再交回 Handler；提交异常不能被误归类。 */
async function executeModelRequest(
  host: DispatchHost,
  plan: DispatchPlan,
  request: InferEffect,
  purpose: 'agent' | 'compaction',
  execute: () => Promise<InferResult>,
) {
  const clock = host.getClock();
  const commitFact = async (build: (builder: DraftBuilder) => void) =>
    host.withLock(async () => {
      if (host.hasFault()) {
        throw new ExecutionCommitError(new ArcherError('CONFLICT', '会话已隔离，不能继续提交模型请求'));
      }
      const builder = new DraftBuilder(host.getState());
      build(builder);
      try {
        await host.commit(builder.finish());
      } catch (error) {
        throw new ExecutionCommitError(error);
      }
    });
  let requestId = '';
  await commitFact((builder) => {
    const located = host.locateEffect(plan.effectId);
    if (
      !located ||
      located.effect.status !== 'started' ||
      host.isStopping() ||
      plan.controller.signal.aborted
    ) {
      throw new Error('模型请求已失效');
    }
    requestId = `${plan.effectId}:request:${located.effect.inferenceRequests.length + 1}`;
    builder.turn(plan.turnId, {
      type: 'inference.requested',
      data: { effectId: plan.effectId, requestId, purpose, request, requestedAt: clock() },
    });
  });
  // 请求指纹关联 Provider 本次调用；requestId 仍是正式事实中的响应关联标识。
  const diagnostics = channel('archer.stream');
  if (diagnostics.hasSubscribers) {
    diagnostics.publish({
      stage: 'Request',
      agentId: host.id,
      effectId: plan.effectId,
      requestId,
      purpose,
      responseId: createHash('sha256')
        .update(canonicalJson(JSON.parse(JSON.stringify(request))))
        .digest('hex')
        .slice(0, 16),
      event: 'start',
    });
  }
  let result: InferResult;
  try {
    if (plan.controller.signal.aborted) {
      throw new Error('Inference was cancelled before invocation.');
    }
    result = await execute();
  } catch (error) {
    // 停止时保留已开始且未确认的请求；不把未知用量记为零。
    if (!host.isStopping()) {
      await commitFact((builder) => {
        builder.turn(plan.turnId, {
          type: 'inference.request.failed',
          data: {
            effectId: plan.effectId,
            requestId,
            error: {
              code: 'PROVIDER_ERROR',
              message: error instanceof Error ? error.message : String(error),
            },
            failedAt: clock(),
          },
        });
      });
    }
    throw error;
  }
  await commitFact((builder) => {
    builder.turn(plan.turnId, {
      type: 'inference.responded',
      data: { effectId: plan.effectId, requestId, result, respondedAt: clock() },
    });
  });
  return {
    requestId,
    attempt: host.locateEffect(plan.effectId)!.effect.attempt,
    purpose,
    request,
    status: 'completed' as const,
    result,
  };
}

/** 采用摘要只追加事实；摘要必须对应已经确认的模型响应。 */
async function commitCompaction(
  host: DispatchHost,
  plan: DispatchPlan,
  requestId: string,
  coveredMessageCount: number,
) {
  return host.withLock(async () => {
    if (host.hasFault() || host.isStopping() || plan.controller.signal.aborted) {
      throw new ArcherError('CONFLICT', '摘要准备已失效');
    }
    const state = host.getState();
    const effect = host.locateEffect(plan.effectId)?.effect;
    const request = effect?.inferenceRequests.find((item) => item.requestId === requestId);
    if (!request?.result) throw new ArcherError('CONFLICT', '摘要响应尚未确认');
    const existing = state.compactions.find((item) => item.requestId === requestId);
    if (existing) return existing;
    const builder = new DraftBuilder(state);
    builder.turn(plan.turnId, {
      type: 'context.compacted',
      data: {
        effectId: plan.effectId,
        requestId,
        coveredMessageCount,
        summary: request.result.content,
        compactedAt: host.getClock()(),
      },
    });
    try {
      await host.commit(builder.finish());
    } catch (error) {
      throw new ExecutionCommitError(error);
    }
    return host.getState().compactions.at(-1)!;
  });
}

async function performPlan(
  host: DispatchHost,
  plan: DispatchPlan,
): Promise<SessionEffectOutcome | null> {
  const state = host.getState();
  const camp = host.getCamp();
  const effect = plan.effect;
  const snapshot = committedHistory(state);
  return host.getEffectPipeline()(effect, {
    history: snapshot.history,
    executionFacts: snapshot.facts,
    agentId: state.agentId,
    turnId: plan.turnId,
    effectId: plan.effectId,
    tokenBudget: state.turns.get(plan.turnId)?.limits.tokenBudget,
    inferenceHistory:
      state.turns.get(plan.turnId)?.effects.flatMap((item) => item.inferenceRequests) ?? [],
    effectRequests: host.locateEffect(plan.effectId)?.effect.inferenceRequests ?? [],
    compactions: state.compactions,
    executeInference: (request, purpose, execute) =>
      executeModelRequest(host, plan, request, purpose, execute),
    commitCompaction: (requestId, coveredMessageCount) =>
      commitCompaction(host, plan, requestId, coveredMessageCount),
    signal: plan.controller.signal,
    now: host.getClock(),
    inference:
      plan.effect.type === 'INFER'
        ? camp.resolve(plan.effect.target, INFERENCE)
        : camp.resolve(host.getInference(), INFERENCE),
    onInferenceProgress: (chunk) => {
      if (!plan.controller.signal.aborted && !host.isStopping() && !host.hasFault()) {
        host.publishProgress(plan, chunk);
      }
    },
    journal: executionJournal(host, plan),
    allowShell: state.turns.get(plan.turnId)?.allowShell === true,
    workspace: state.workspace,
    files: state.workspace ? workspaceFiles(state.workspace, plan.controller.signal) : undefined,
    prepare: async (request) => {
      const implementation = camp.resolve(request.ref, INFERENCE_PREPARE);
      const files = state.workspace
        ? workspaceFiles(state.workspace, plan.controller.signal)
        : undefined;
      const value = await implementation.prepare(structuredClone(request.input), {
        signal: plan.controller.signal,
        workspace: state.workspace,
        inference:
          plan.effect.type === 'INFER'
            ? freezeSnapshot({
                messages: plan.effect.messages,
                ...(plan.effect.config ? { config: plan.effect.config } : {}),
              })
            : undefined,
        files: files
          ? {
              ...files,
              write: async () => {
                throw new Error('Read-only preparation cannot write files.');
              },
            }
          : undefined,
      });
      assertJsonValue(value, 'Preparation result');
      return freezeSnapshot(value);
    },
    target: plan.preflight,
    targetError: plan.preflightError,
    isStopping: () => host.isStopping(),
  });
}
