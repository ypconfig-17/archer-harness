import { validateWorkspace } from '@archer/providers';
/**
 * Archer Harness — AgentManager 实现
 *
 * 管理器只维护已在线的会话运行时；创建、删除与执行配置变更都先提交事实。
 * 句柄不持有额外状态，所有查询回到对应的 SessionRuntime。
 */

import type {
  Agent,
  InferenceProgress,
  HumanTarget,
  HumanToken,
  HumanReply,
  ReconcileInput,
  AgentEvent,
  AgentInput,
  AgentJournal,
  AgentListInput,
  AgentManager,
  AgentSnapshot,
  AgentSummary,
  CreateAgentOptions,
  EffectExecutionRecord,
  EventReadInput,
  InputOptions,
  JsonObject,
  ReadOptions,
  RenameAgentInput,
  ConfigureExecutionInput,
  Snapshot,
  SteerOptions,
  SubmitOptions,
  PromptOptions,
  AbortOptions,
  TurnQueries,
  TurnRef,
  WaitOptions,
  WatchOptions,
} from '@archer/contracts';
import {
  ArcherError,
  CreateAgentOptionsSchema,
  RenameAgentInputSchema,
  ConfigureExecutionSchema,
  canonicalJson,
  freezeSnapshot,
} from '@archer/contracts';
import { replayAgent } from '@archer/agent';
import { createAgentDecision } from '../execution/session-step.js';
import type { SessionState } from '@archer/agent';
import { SessionRuntime } from './session-runtime.js';
import type { Camp, CapabilityRef } from '@archer/contracts';

export interface AgentManagerOptions {
  journal: AgentJournal;
  inference: CapabilityRef;
  camp: Camp;
  preparations: readonly CapabilityRef[];
  clock: () => number;
  onError: (error: ArcherError) => void;
  onEffectExecuted?: (record: EffectExecutionRecord) => void;
}

function declarationKey(
  instructions: string,
  inference: unknown,
  workspace: CreateAgentOptions['workspace'],
): string {
  return canonicalJson({
    instructions,
    ...(workspace ? { workspace } : {}),
    inference: (inference ?? {}) as JsonObject,
  });
}

function byAgentId(a: SessionRuntime, b: SessionRuntime): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function assertReadable(options: ReadOptions | undefined): void {
  if (options?.signal?.aborted) {
    throw new ArcherError('ABORTED', '读取已取消');
  }
}

class AgentHandle implements Agent {
  readonly turns: TurnQueries;

  constructor(private readonly runtime: SessionRuntime) {
    this.turns = runtime.turns;
  }

  get id(): string {
    return this.runtime.id;
  }

  prompt(input: AgentInput, options?: PromptOptions): Promise<void> {
    return this.runtime.prompt(input, options);
  }

  send(input: AgentInput, options?: SubmitOptions): Promise<TurnRef> {
    return this.runtime.send(input, options);
  }

  steer(input: AgentInput, options?: SteerOptions): Promise<void> {
    return this.runtime.steer(input, options);
  }

  followUp(input: AgentInput, options?: InputOptions): Promise<void> {
    return this.runtime.followUp(input, options);
  }

  abort(options?: AbortOptions): Promise<void> {
    return this.runtime.abort(options);
  }

  wait(turnId: string, options?: WaitOptions): Promise<void> {
    return this.runtime.wait(turnId, options);
  }

  getState(options?: ReadOptions): Promise<Snapshot<AgentSnapshot>> {
    return this.runtime.getState(options);
  }

  events(
    input: EventReadInput = {},
    options?: ReadOptions,
  ): Promise<readonly Snapshot<AgentEvent>[]> {
    return this.runtime.events(input, options);
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    return this.runtime.subscribe(listener);
  }
}

export class AgentRegistry implements AgentManager {
  private readonly runtimeById = new Map<string, SessionRuntime>();
  private readonly handleById = new Map<string, AgentHandle>();
  private readonly recoveryErrors = new Map<string, ArcherError>();
  private managerOptions: AgentManagerOptions | null = null;
  private active = false;
  private createLock: Promise<unknown> = Promise.resolve();

  /** 容器在依赖打开后接入；之前的所有命令拒绝准入 */
  attach(options: AgentManagerOptions): void {
    this.managerOptions = options;
  }

  private deps(): AgentManagerOptions {
    if (!this.managerOptions) {
      throw new ArcherError('ARCHER_NOT_RUNNING', 'Archer 未处于运行状态');
    }
    return this.managerOptions;
  }

  /** 启动恢复使用：按事件重建运行时，执行引用从事实恢复 */
  adopt(state: SessionState, events: readonly AgentEvent[]): SessionRuntime {
    const options = this.deps();
    const runtime = new SessionRuntime({
      state,
      events,
      journal: options.journal,
      inference: options.inference,
      camp: options.camp,
      preparations: options.preparations,
      clock: options.clock,
      onError: options.onError,
      onEffectExecuted: options.onEffectExecuted,
    });
    this.runtimeById.set(runtime.id, runtime);

    this.handleById.set(runtime.id, new AgentHandle(runtime));
    if (this.active) runtime.activate();
    return runtime;
  }

  activateAll(): void {
    this.active = true;
    for (const runtime of this.runtimeById.values()) runtime.activate();
  }

  deactivateAll(): void {
    this.active = false;
    for (const runtime of this.runtimeById.values()) runtime.deactivate();
  }

  /** 启动恢复：读取全部 Agent 日志；单个损坏只隔离该 Agent */
  async load(): Promise<SessionRuntime[]> {
    const options = this.deps();
    const ids = await options.journal.ids();
    const runtimes: SessionRuntime[] = [];
    for (const agentId of ids) {
      try {
        const events = await options.journal.read(agentId);
        const state = replayAgent(agentId, events);
        if (!state) continue;
        runtimes.push(this.adopt(state, events));
      } catch (error: unknown) {
        const reported = new ArcherError(
          error instanceof ArcherError ? error.code : 'EVENT_LOG_CORRUPT',
          `会话日志未通过恢复校验，已隔离，原始日志仍保留：${agentId}。原因：${error instanceof Error ? error.message : String(error)}`,
          { agentId, recovery: true, cause: error instanceof Error ? error.message : String(error) },
        );
        this.recoveryErrors.set(agentId, reported);
        options.onError(reported);
      }
    }
    return runtimes;
  }

  watchProgress(agentId: string, options: ReadOptions = {}): AsyncIterable<Snapshot<InferenceProgress>> {
    return this.requireRuntime(agentId).watchProgress(options);
  }
  issueHumanToken(agentId: string, input: HumanTarget): Promise<HumanToken> {
    return this.requireRuntime(agentId).issueHumanToken(input);
  }
  reply(agentId: string, input: HumanReply): Promise<void> {
    return this.requireRuntime(agentId).reply(input);
  }
  reconcile(agentId: string, input: ReconcileInput): Promise<void> {
    return this.requireRuntime(agentId).reconcile(input);
  }

  private requireRuntime(agentId: string): SessionRuntime {
    const recoveryError = this.recoveryErrors.get(agentId);
    if (recoveryError) throw recoveryError;
    const runtime = this.runtimeById.get(agentId);
    if (!runtime || runtime.removed) {
      throw new ArcherError('NOT_FOUND', `Agent 不存在：${agentId}`, { agentId });
    }
    return runtime;
  }

  private handle(runtime: SessionRuntime): Agent {
    let handle = this.handleById.get(runtime.id);
    if (!handle) {
      handle = new AgentHandle(runtime);
      this.handleById.set(runtime.id, handle);
    }
    return handle;
  }

  async create(options: CreateAgentOptions): Promise<Agent> {
    if (!this.active) {
      throw new ArcherError('ARCHER_NOT_RUNNING', 'Archer 未处于运行状态');
    }
    const parsed = CreateAgentOptionsSchema.safeParse(options);
    if (!parsed.success) {
      throw new ArcherError('INVALID_ARGUMENT', '创建声明不符合 Agent 协议', {
        issues: parsed.error.issues.map((issue) => issue.message),
      });
    }
    const input = parsed.data;
    if (input.workspace) {
      try { validateWorkspace(input.workspace); }
      catch (error) { throw new ArcherError('INVALID_ARGUMENT', error instanceof Error ? error.message : String(error)); }
    }
    const createKey = declarationKey(input.instructions, input.inference, input.workspace);
    const next = this.createLock.then(
      () => this.createLocked(input, createKey),
      () => this.createLocked(input, createKey),
    );
    this.createLock = next.catch(() => undefined);
    return next;
  }

  private async createLocked(
    input: CreateAgentOptions,
    createKey: string,
  ): Promise<Agent> {
    const recoveryError = this.recoveryErrors.get(input.id);
    if (recoveryError) throw recoveryError;
    const existing = this.runtimeById.get(input.id);
    if (existing) {
      if (existing.removed) {
        throw new ArcherError('CONFLICT', `Agent 已被删除，不能复用 id：${input.id}`);
      }
      if (existing.createKey !== createKey) {
        throw new ArcherError('CONFLICT', `Agent 已存在且创建声明不同：${input.id}`);
      }
      return this.handle(existing);
    }

    const deps = this.deps();
    const decision = createAgentDecision(null, input, createKey, {
      now: deps.clock(),
    });
    if (!decision.ok) throw decision.error;
    const { state, drafts } = decision.value;
    const expectedSeq = state.seq - drafts.length;

    let committed: readonly AgentEvent[];
    try {
      committed = await deps.journal.append({
        agentId: state.agentId,
        expectedSeq,
        drafts,
      });
    } catch (error: unknown) {
      if (error instanceof ArcherError) throw error;
      throw new ArcherError('INTERNAL', '创建 Agent 提交失败');
    }
    const last = committed.at(-1);
    if (!last || last.seq !== state.seq || committed.length !== drafts.length) {
      throw new ArcherError('INTERNAL', '创建 Agent 的提交结果与决策不一致', {
        agentId: state.agentId,
      });
    }

    const runtime = this.adopt(state, committed);
    return this.handle(runtime);
  }

  async get(agentId: string, options?: ReadOptions): Promise<Agent | null> {
    assertReadable(options);
    const recoveryError = this.recoveryErrors.get(agentId);
    if (recoveryError) throw recoveryError;
    const runtime = this.runtimeById.get(agentId);
    if (!runtime || runtime.removed) return null;
    return this.handle(runtime);
  }

  async list(
    input: AgentListInput = {},
    options?: ReadOptions,
  ): Promise<readonly Snapshot<AgentSummary>[]> {
    assertReadable(options);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    return [...this.runtimeById.values()]
      .filter((runtime) => !runtime.removed)
      .filter((runtime) => input.afterId === undefined || runtime.id > input.afterId)
      .sort(byAgentId)
      .slice(0, limit)
      .map((runtime) => freezeSnapshot(runtime.summary()));
  }

  async remove(agentId: string): Promise<void> {
    const runtime = this.requireRuntime(agentId);
    await runtime.remove();
  }

  async rename(agentId: string, input: RenameAgentInput): Promise<void> {
    const parsed = RenameAgentInputSchema.safeParse(input);
    if (!parsed.success) throw new ArcherError('INVALID_ARGUMENT', '会话标题必须为 1 到 200 个字符');
    await this.requireRuntime(agentId).rename(parsed.data.title);
  }

  async configureExecution(agentId: string, input: ConfigureExecutionInput): Promise<void> {
    const parsed = ConfigureExecutionSchema.safeParse(input);
    if (!parsed.success) throw new ArcherError('INVALID_ARGUMENT', '执行配置不符合协议');
    await this.requireRuntime(agentId).configureExecution(parsed.data.expectedRevision, parsed.data.workspaceAccess, parsed.data.commandAuthorization);
  }

  async resumeQueue(agentId: string): Promise<void> {
    await this.requireRuntime(agentId).resumeQueue();
  }

  async clearQueue(agentId: string): Promise<void> {
    await this.requireRuntime(agentId).clearQueue();
  }

  watch(agentId: string, options: WatchOptions): AsyncIterable<Snapshot<AgentEvent>> {
    const runtime = this.requireRuntime(agentId);
    return runtime.watchAgent(options);
  }

  /** 运行中的会话；供容器编排启动、恢复与停止 */
  runtimes(): readonly SessionRuntime[] {
    return [...this.runtimeById.values()];
  }

  retryBlocked(): void {
    for (const runtime of this.runtimeById.values()) runtime.retryBlocked();
  }
}
