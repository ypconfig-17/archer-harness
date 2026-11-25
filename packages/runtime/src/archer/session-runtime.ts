/**
 * Archer Harness — 单个 Agent 的串行提交与执行
 *
 * 所有事实先经纯决策生成草稿，提交成功后才执行命令。
 * 每个 Agent 一把提交锁；Effect 执行在锁外进行，结果回到锁内收束。
 */

import { channel } from 'node:diagnostics_channel';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  AbortOptions,
  AgentEvent,
  AgentExecution,
  AgentInput,
  AgentJournal,
  AgentSnapshot,
  AgentSummary,
  Camp,
  CapabilityRef,
  ErrorData,
  EventReadInput,
  FollowUpOptions,
  HumanReply,
  HumanTarget,
  HumanToken,
  InferenceChunk,
  InferenceProgress,
  PromptOptions,
  ReadOptions,
  ReconcileInput,
  Snapshot,
  SteerOptions,
  SubmitOptions,
  TurnEvent,
  TurnLimits,
  TurnRef,
  TurnSnapshot,
  WaitOptions,
  WatchOptions,
} from '@archer/contracts';
import {
  AgentInputSchema,
  ArcherError,
  InferConfigSchema,
  InferenceChunkSchema,
  TurnLimitsSchema,
  freezeSnapshot,
  isTerminalTurnStatus,
} from '@archer/contracts';
import { run } from '@archer/kernel';
import type {
  AcceptedInput,
  PromptFrame,
  SessionAgentPolicy,
  SessionCommand,
  SessionContext,
  SessionDecision,
  SessionEffect,
  SessionState,
  SessionTurn,
} from '@archer/agent';
import { activeTurnOf, agentSnapshot, turnSnapshot } from '@archer/agent';
import { createExecutionPipeline, type EffectHandler } from '@archer/handler';
import {
  abortDecision,
  acceptInputDecision,
  canConsumeQueuedInput,
  clearQueueDecision,
  configureExecutionDecision,
  consumeQueuedDecision,
  humanReplyDecision,
  previewInputAcceptance,
  reconcileDecision,
  recoverDecision,
  removeDecision,
  renameDecision,
  resumeQueueDecision,
  steerDecision,
  suspendEffectDecision,
} from '../execution/session-step.js';
import { dispatchEffect, type DispatchHost } from './session-dispatch.js';
import { withPreparedPrompt, type PromptCoordinatorHost } from './session-prompt.js';
import {
  STALE_PROMPT,
  SUSPEND_TTL_MS,
  TERMINAL_TURN_FACTS,
  eventWindow,
  mapError,
  turnEventsOf,
  turnFailure,
  type DispatchPlan,
  type InFlight,
  type PromptPreparation,
  type SessionRuntimeOptions,
  type Waiter,
} from './session-runtime-types.js';

export type { SessionRuntimeOptions } from './session-runtime-types.js';

export class SessionRuntime {
  private state: SessionState;
  private readonly eventsLog: AgentEvent[];
  private readonly journal: AgentJournal;
  private readonly inference: CapabilityRef;
  private readonly camp: Camp;
  private readonly preparations: readonly CapabilityRef[];
  private readonly lifecycle = new AbortController();
  private readonly clock: () => number;
  private readonly onError: (error: ArcherError) => void;
  private readonly effectPipeline: EffectHandler;

  private faultData: ErrorData | null = null;
  private admitted = false;
  private stopping = false;
  private lock: Promise<unknown> = Promise.resolve();
  private readonly promptPreparations = new Set<PromptPreparation>();
  private readonly preparationTasks = new Set<Promise<PromptFrame>>();
  private readonly inFlight = new Map<string, InFlight>();
  private readonly blocked = new Set<string>();
  private readonly executions = new Set<Promise<void>>();
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private readonly wakeups = new Set<() => void>();
  private readonly waiters = new Set<Waiter>();
  private latestProgress: Snapshot<InferenceProgress> | null = null;
  private readonly progressListeners = new Set<
    (progress: Snapshot<InferenceProgress> | null) => void
  >();

  private readonly agentPolicy?: SessionAgentPolicy;

  private get decisionContext(): SessionContext {
    return { now: this.clock(), agentPolicy: this.agentPolicy };
  }

  private readonly promptHost: PromptCoordinatorHost = {
    withLock: (task) => this.withLock(task),
    getState: () => this.state,
    getCamp: () => this.camp,
    getInference: () => this.inference,
    getPreparations: () => this.preparations,
    getLifecycleSignal: () => this.lifecycle.signal,
    getPromptPreparations: () => this.promptPreparations,
    getPreparationTasks: () => this.preparationTasks,
  };

  private readonly dispatchHost: DispatchHost = {
    get id() {
      return this.getState().agentId;
    },
    withLock: (task) => this.withLock(task),
    commit: (decision) => this.commit(decision),
    getState: () => this.state,
    getCamp: () => this.camp,
    getInference: () => this.inference,
    getClock: () => this.clock,
    getDecisionContext: () => this.decisionContext,
    getEffectPipeline: () => this.effectPipeline,
    isAdmitted: () => this.admitted,
    isStopping: () => this.stopping,
    hasFault: () => this.faultData !== null,
    getInFlight: () => this.inFlight,
    getBlocked: () => this.blocked,
    locateEffect: (effectId) => this.locateEffect(effectId),
    publishProgress: (plan, chunk, phase) => this.publishProgress(plan, chunk, phase),
    getLatestProgress: () => this.latestProgress,
    suspend: (effectId) => this.suspend(effectId),
    maybeConsumeQueue: () => this.maybeConsumeQueue(),
  };

  constructor(options: SessionRuntimeOptions) {
    this.agentPolicy = options.agentPolicy;
    if ((options.agentPolicy?.id ?? 'function-call') !== options.state.policyId) {
      throw new ArcherError('CONFLICT', 'Agent 策略与持久化声明不一致');
    }
    this.state = options.state;
    this.eventsLog = [...options.events];
    this.journal = options.journal;
    this.inference = options.inference;
    this.camp = options.camp;
    this.preparations = options.preparations;
    this.clock = options.clock;
    this.onError = options.onError;
    this.effectPipeline = createExecutionPipeline(options.onEffectExecuted);
  }

  get id(): string {
    return this.state.agentId;
  }

  get createKey(): string {
    return this.state.createKey;
  }

  get removed(): boolean {
    return this.state.removed;
  }

  get fault(): ErrorData | null {
    return this.faultData;
  }

  get currentExecution(): AgentExecution {
    if (this.faultData) return 'isolated';
    if (this.blocked.size > 0) return 'blocked';
    return 'ready';
  }

  /** 最近一条已提交事实的时间；取自事件信封，回放后仍可重建，不依赖运行时时钟。 */
  private get lastCommittedAt(): number {
    return this.eventsLog.at(-1)?.ts ?? this.state.createdAt;
  }

  summary(): AgentSummary {
    return {
      id: this.state.agentId,
      createdAt: this.state.createdAt,
      updatedAt: this.lastCommittedAt,
      ...(this.state.title ? { title: this.state.title } : {}),
      seq: this.state.seq,
      activeTurnId: this.state.activeTurnId,
      queuePaused: this.state.queuePaused,
    };
  }

  /** 开放普通准入；容器在恢复前调用，恢复事实同样走串行边界 */
  activate(): void {
    this.admitted = true;
    this.retryBlocked();
  }

  deactivate(): void {
    this.admitted = false;
    for (const listener of this.progressListeners) {
      listener(null);
    }
  }

  // ─────────────────────────────────────────────
  // 串行边界
  // ─────────────────────────────────────────────

  private withLock<T>(task: () => Promise<T>): Promise<T> {
    const next = this.lock.then(task, task);
    this.lock = next.catch(() => undefined);
    return next;
  }

  private requireOpen(): void {
    if (!this.admitted) {
      throw new ArcherError('ARCHER_NOT_RUNNING', 'Archer 未处于运行状态', {
        agentId: this.state.agentId,
      });
    }
  }

  private requireWritable(): void {
    if (this.state.removed) {
      throw new ArcherError('NOT_FOUND', `Agent 不存在：${this.state.agentId}`);
    }
    if (this.faultData) {
      throw this.isolatedError();
    }
  }

  private isolatedError(): ArcherError {
    const fault = this.faultData;
    return new ArcherError(
      'AGENT_ISOLATED',
      fault?.message ?? `Agent 已隔离：${this.state.agentId}`,
      {
        agentId: this.state.agentId,
        ...(fault ? { faultCode: fault.code } : {}),
      },
    );
  }

  private isolate(error: unknown): void {
    if (this.faultData) return;
    const data = mapError(error);
    this.faultData = data;
    for (const preparation of this.promptPreparations) {
      preparation.controller.abort(this.isolatedError());
    }
    const reported =
      error instanceof ArcherError
        ? error
        : new ArcherError('INTERNAL', data.message, { agentId: this.state.agentId });
    try {
      this.onError(reported);
    } catch {
      // 宿主错误回调不能反向破坏 Agent 状态
    }
    for (const flight of this.inFlight.values()) flight.controller.abort();
    for (const waiter of [...this.waiters]) {
      this.waiters.delete(waiter);
      waiter.reject(this.isolatedError());
    }
    for (const wake of [...this.wakeups]) {
      this.wakeups.delete(wake);
      wake();
    }
  }

  private async commit(
    decision: SessionDecision,
    preparationAbortReason: unknown = STALE_PROMPT,
  ): Promise<AgentEvent[]> {
    if (decision.drafts.length === 0) return [];
    let committed: readonly AgentEvent[];
    try {
      committed = await this.journal.append({
        agentId: this.state.agentId,
        expectedSeq: this.state.seq,
        drafts: decision.drafts,
      });
    } catch (error: unknown) {
      if (
        error instanceof ArcherError &&
        (error.code === 'COMMIT_UNKNOWN' || error.code === 'EVENT_LOG_CORRUPT')
      ) {
        this.isolate(error);
      }
      throw error;
    }
    const last = committed.at(-1);
    if (!last || last.seq !== this.state.seq + decision.drafts.length) {
      const error = new ArcherError('INTERNAL', 'Agent 日志提交结果与决策不一致', {
        agentId: this.state.agentId,
      });
      this.isolate(error);
      throw error;
    }
    this.state = decision.state;
    this.state.seq = last.seq;
    for (const preparation of this.promptPreparations) {
      preparation.controller.abort(preparationAbortReason);
    }
    this.eventsLog.push(...committed);
    if (this.state.removed) for (const listener of this.progressListeners) listener(null);
    if (this.latestProgress?.phase === 'generating') {
      const effect = this.locateEffect(this.latestProgress.effectId)?.effect;
      if (effect && ['completed', 'failed', 'cancelled', 'unknown'].includes(effect.status)) {
        this.latestProgress = freezeSnapshot({
          ...this.latestProgress,
          phase: effect.status === 'completed' ? 'settled' : 'interrupted',
        });
        for (const listener of this.progressListeners) listener(this.latestProgress);
      }
    }
    this.publish(committed);
    return [...committed];
  }

  private publish(committed: readonly AgentEvent[]): void {
    for (const event of committed) {
      const snapshot = freezeSnapshot(event);
      for (const listener of [...this.listeners]) {
        try {
          listener(snapshot as AgentEvent);
        } catch {
          // 监听器异常彼此隔离
        }
      }
      if (event.fact.scope === 'turn' && TERMINAL_TURN_FACTS.has(event.fact.event.type)) {
        this.resolveWaiters(event.fact.turnId);
      }
    }
    for (const wake of [...this.wakeups]) {
      this.wakeups.delete(wake);
      wake();
    }
  }

  private resolveWaiters(turnId: string): void {
    for (const waiter of [...this.waiters]) {
      if (waiter.turnId !== turnId) continue;
      this.waiters.delete(waiter);
      waiter.resolve();
    }
  }

  // ─────────────────────────────────────────────
  // 输入与 Turn
  // ─────────────────────────────────────────────

  private parseInput(input: AgentInput): AgentInput {
    const parsed = AgentInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ArcherError('INVALID_ARGUMENT', '输入不符合 AgentInput 协议');
    }
    return parsed.data;
  }

  private parseLimits(limits: TurnLimits | undefined): TurnLimits | undefined {
    if (!limits) return undefined;
    const parsed = TurnLimitsSchema.safeParse(limits);
    if (!parsed.success) {
      throw new ArcherError('INVALID_ARGUMENT', 'TurnLimits 必须为正整数');
    }
    return parsed.data;
  }

  private async submit(
    command: 'prompt' | 'send' | 'followUp',
    input: AgentInput,
    options: SubmitOptions,
  ): Promise<{ turnId: string | null }> {
    const parsedInput = this.parseInput(input);
    const limits = this.parseLimits(options.limits);
    const inference =
      options.inference === undefined ? undefined : InferConfigSchema.safeParse(options.inference);
    if (inference && !inference.success) {
      throw new ArcherError('INVALID_ARGUMENT', '推理配置不合法');
    }
    const requestId = options.requestId ?? randomUUID();
    const allowShell = options.allowShell === true;
    const commandMode = options.commandMode ?? 'ask';
    if (!['ask', 'auto', 'full'].includes(commandMode)) {
      throw new ArcherError('INVALID_ARGUMENT', '命令模式不合法');
    }
    let commands: SessionCommand[] = [];
    let turnId: string | null = null;

    const base: Omit<AcceptedInput, 'promptFrame'> = {
      command,
      requestId,
      input: parsedInput,
      allowShell,
      commandMode,
      ...(limits ? { limits } : {}),
      ...(inference?.success ? { inference: inference.data } : {}),
    };
    await withPreparedPrompt(
      this.promptHost,
      () => {
        this.requireOpen();
        this.requireWritable();
        const preview = previewInputAcceptance(this.state, base);
        if (!preview.ok) throw preview.error;
        return preview.value.startsTurn;
      },
      async (promptFrame) => {
        const accepted: AcceptedInput = { ...base, ...(promptFrame ? { promptFrame } : {}) };
        const decision = acceptInputDecision(this.state, accepted, this.decisionContext);
        if (!decision.ok) throw decision.error;
        commands = decision.value.decision.commands;
        turnId = decision.value.turnId;
        await this.commit(decision.value.decision);
      },
    );

    this.runCommands(commands);
    return { turnId };
  }

  async send(input: AgentInput, options: SubmitOptions = {}): Promise<TurnRef> {
    const { turnId } = await this.submit('send', input, options);
    if (!turnId) {
      throw new ArcherError('INTERNAL', 'send 未创建 Turn', { agentId: this.state.agentId });
    }
    return { agentId: this.state.agentId, turnId };
  }

  async prompt(input: AgentInput, options: PromptOptions = {}): Promise<void> {
    if (options.signal?.aborted) {
      throw new ArcherError('ABORTED', '等待已取消');
    }
    const { turnId } = await this.submit('prompt', input, options);
    if (!turnId) {
      throw new ArcherError('INTERNAL', 'prompt 未创建 Turn', { agentId: this.state.agentId });
    }
    await this.wait(turnId, options.signal ? { signal: options.signal } : {});
  }

  async followUp(input: AgentInput, options: FollowUpOptions = {}): Promise<void> {
    await this.submit('followUp', input, options);
  }

  async steer(input: AgentInput, options: SteerOptions = {}): Promise<void> {
    const parsedInput = this.parseInput(input);
    const requestId = options.requestId ?? randomUUID();
    await this.withLock(async () => {
      this.requireOpen();
      this.requireWritable();
      const decision = steerDecision(
        this.state,
        parsedInput,
        {
          requestId,
          ...(options.turnId !== undefined ? { turnId: options.turnId } : {}),
        },
        this.decisionContext,
      );
      if (!decision.ok) throw decision.error;
      await this.commit(decision.value);
    });
  }

  async abort(options: AbortOptions = {}): Promise<void> {
    const requestId = options.requestId ?? randomUUID();
    let commands: SessionCommand[] = [];
    await this.withLock(async () => {
      this.requireOpen();
      this.requireWritable();
      const decision = abortDecision(
        this.state,
        {
          requestId,
          ...(options.turnId !== undefined ? { turnId: options.turnId } : {}),
          ...(options.reason !== undefined ? { reason: options.reason } : {}),
        },
        this.decisionContext,
      );
      if (!decision.ok) throw decision.error;
      commands = decision.value.commands;
      await this.commit(decision.value, new ArcherError('ABORTED', '输入准备已取消'));
    });
    this.runCommands(commands);
  }

  async wait(turnId: string, options: WaitOptions = {}): Promise<void> {
    const signal = options.signal;
    while (true) {
      const turn = this.state.turns.get(turnId);
      if (!turn) {
        throw new ArcherError('NOT_FOUND', `Turn 不存在：${turnId}`, { turnId });
      }
      if (isTerminalTurnStatus(turn.status)) {
        const failure = turnFailure(turn);
        if (failure) throw failure;
        return;
      }
      if (signal?.aborted) throw new ArcherError('ABORTED', '等待已取消');
      await new Promise<void>((resolve, reject) => {
        const waiter: Waiter = { turnId, resolve, reject };
        const onAbort = (): void => {
          this.waiters.delete(waiter);
          reject(new ArcherError('ABORTED', '等待已取消'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        const settle = (): void => {
          signal?.removeEventListener('abort', onAbort);
        };
        const originalResolve = waiter.resolve;
        const originalReject = waiter.reject;
        waiter.resolve = (): void => {
          settle();
          originalResolve();
        };
        waiter.reject = (error: unknown): void => {
          settle();
          originalReject(error);
        };
        this.waiters.add(waiter);
      });
    }
  }

  // ─────────────────────────────────────────────
  // 管理命令
  // ─────────────────────────────────────────────

  async configureExecution(
    expectedRevision: number,
    workspaceAccess?: import('@archer/contracts').Workspace['access'],
    commandAuthorization?: import('@archer/contracts').ConfigureExecutionInput['commandAuthorization'],
  ): Promise<void> {
    const commands = await this.withLock(async () => {
      this.requireWritable();
      const now = this.clock();
      const approval = commandAuthorization?.approveCommand;
      if (approval) {
        // 凭证只用于进程内校验，不写入配置事实；同一锁内固定原任务与命令。
        const effect = this.pendingTarget(
          { turnId: commandAuthorization.turnId, effectId: approval.effectId },
          'human',
        );
        const expected = Buffer.from(effect.suspended?.resumeTokenHash ?? '', 'hex');
        const actual = createHash('sha256').update(approval.token).digest();
        if (
          !effect.suspended ||
          effect.suspended.expiresAt === undefined ||
          now >= effect.suspended.expiresAt ||
          expected.length !== actual.length ||
          !timingSafeEqual(expected, actual)
        ) {
          throw new ArcherError('CONFLICT', '人工凭证已过期或不匹配，请重新确认');
        }
      }
      const decision = configureExecutionDecision(
        this.state,
        expectedRevision,
        workspaceAccess,
        commandAuthorization,
        { ...this.decisionContext, now },
      );
      if (!decision.ok) throw decision.error;
      await this.commit(decision.value);
      return decision.value.commands;
    });
    // 提交成功后才调度当前命令；提交失败或未知沿用 Runtime 的隔离规则。
    this.runCommands(commands);
  }

  async rename(title: string): Promise<void> {
    await this.withLock(async () => {
      this.requireOpen();
      this.requireWritable();
      const decision = renameDecision(this.state, title, this.decisionContext);
      if (!decision.ok) throw decision.error;
      await this.commit(decision.value);
    });
  }

  async remove(): Promise<void> {
    await this.withLock(async () => {
      this.requireOpen();
      this.requireWritable();
      const decision = removeDecision(this.state, this.decisionContext);
      if (!decision.ok) throw decision.error;
      await this.commit(decision.value);
      for (const flight of this.inFlight.values()) flight.controller.abort();
    });
  }

  async resumeQueue(): Promise<void> {
    const requestId = randomUUID();
    let commands: SessionCommand[] = [];
    await this.withLock(async () => {
      this.requireOpen();
      this.requireWritable();
      const decision = resumeQueueDecision(this.state, requestId, this.decisionContext);
      if (!decision.ok) throw decision.error;
      commands = decision.value.commands;
      await this.commit(decision.value);
    });
    this.runCommands(commands);
    await this.maybeConsumeQueue();
  }

  async clearQueue(): Promise<void> {
    const requestId = randomUUID();
    await this.withLock(async () => {
      this.requireOpen();
      this.requireWritable();
      const decision = clearQueueDecision(this.state, requestId);
      if (!decision.ok) throw decision.error;
      await this.commit(decision.value);
    });
  }

  // ─────────────────────────────────────────────
  // 启动恢复
  // ─────────────────────────────────────────────

  async recover(signal?: AbortSignal): Promise<void> {
    const commands = await withPreparedPrompt(
      this.promptHost,
      () => {
        if (this.state.removed || this.stopping || this.faultData) return false;
        return canConsumeQueuedInput(this.state);
      },
      async (promptFrame) => {
        if (this.state.removed || this.stopping || this.faultData) return [];
        const decision = recoverDecision(
          this.state,
          promptFrame ?? { prefix: [], tools: [], preparations: [] },
          this.decisionContext,
        );
        await this.commit(decision);
        return decision.commands;
      },
      false,
      signal,
    );
    this.runCommands(commands);
  }

  async shutdown(): Promise<void> {
    this.admitted = false;
    this.stopping = true;
    this.lifecycle.abort();
    for (const flight of this.inFlight.values()) flight.controller.abort();
    await Promise.allSettled([...this.executions, ...this.preparationTasks]);
  }

  retryBlocked(): void {
    if (this.faultData || this.stopping || this.state.removed || !this.admitted) return;
    for (const effectId of [...this.blocked]) {
      const located = this.locateEffect(effectId);
      if (
        !located ||
        (located.effect.status !== 'created' && located.effect.status !== 'resumed')
      ) {
        this.blocked.delete(effectId);
        continue;
      }
      this.runCommands([{ type: 'dispatch_effect', effectId }]);
    }
  }

  // ─────────────────────────────────────────────
  // 订阅与查询
  // ─────────────────────────────────────────────

  /** 每个订阅者最多缓存一帧累计快照；慢消费者不会堆积 token 队列。 */
  async *watchProgress(options: ReadOptions = {}): AsyncGenerator<Snapshot<InferenceProgress>> {
    this.requireReadable(options);
    let pending = this.latestProgress;
    let wake: (() => void) | undefined;
    const listener = (progress: Snapshot<InferenceProgress> | null) => {
      pending = progress;
      wake?.();
    };
    const abort = () => wake?.();
    this.progressListeners.add(listener);
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      while (!options.signal?.aborted && this.admitted && !this.state.removed) {
        if (pending) {
          const frame = pending;
          pending = null;
          yield frame;
        } else {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      }
    } finally {
      this.progressListeners.delete(listener);
      options.signal?.removeEventListener('abort', abort);
    }
  }

  private publishProgress(
    plan: DispatchPlan,
    chunk: InferenceChunk,
    phase: InferenceProgress['phase'] = 'generating',
  ): void {
    if (plan.effect.type !== 'INFER' || !this.admitted) return;
    if (
      phase === 'generating' &&
      (this.inFlight.get(plan.effectId)?.controller !== plan.controller ||
        this.locateEffect(plan.effectId)?.effect.status !== 'started')
    ) {
      return;
    }
    const parsed = InferenceChunkSchema.safeParse(chunk);
    if (!parsed.success) return;
    const frame = freezeSnapshot({
      ...parsed.data,
      agentId: this.id,
      turnId: plan.turnId,
      effectId: plan.effectId,
      phase,
    });
    // 临时通道诊断只观察实际发布时机，不改变锁、提交或慢消费者合并规则。
    const diagnostics = channel('archer.stream');
    if (diagnostics.hasSubscribers) {
      diagnostics.publish({
        stage: 'Runtime',
        agentId: this.id,
        effectId: plan.effectId,
        event: phase,
        content: frame.content.length,
        reasoning: frame.reasoning?.length ?? 0,
      });
    }
    this.latestProgress = frame;
    for (const listener of this.progressListeners) listener(frame);
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async getState(options: ReadOptions = {}): Promise<Snapshot<AgentSnapshot>> {
    this.requireReadable(options);
    return freezeSnapshot(
      agentSnapshot(
        this.state,
        this.lastCommittedAt,
        this.currentExecution,
        this.faultData ?? undefined,
      ),
    );
  }

  async events(
    input: EventReadInput = {},
    options: ReadOptions = {},
  ): Promise<readonly Snapshot<AgentEvent>[]> {
    this.requireReadable(options);
    const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
    return eventWindow(this.eventsLog, input, limit).map((event) => freezeSnapshot(event));
  }

  readonly turns = {
    get: async (
      turnId: string,
      options: ReadOptions = {},
    ): Promise<Snapshot<TurnSnapshot> | null> => {
      this.requireReadable(options);
      const turn = this.state.turns.get(turnId);
      return turn ? freezeSnapshot(turnSnapshot(this.id, turn)) : null;
    },
    findByRequestId: async (
      requestId: string,
      options: ReadOptions = {},
    ): Promise<Snapshot<TurnSnapshot> | null> => {
      this.requireReadable(options);
      const request = this.state.requests.get(requestId);
      if (!request?.turnId) return null;
      if (
        request.command !== 'prompt' &&
        request.command !== 'send' &&
        request.command !== 'followUp'
      ) {
        return null;
      }
      const turn = this.state.turns.get(request.turnId);
      return turn ? freezeSnapshot(turnSnapshot(this.id, turn)) : null;
    },
    list: async (
      input: { beforeAgentSeq?: number; limit?: number } = {},
      options: ReadOptions = {},
    ): Promise<readonly Snapshot<TurnSnapshot>[]> => {
      this.requireReadable(options);
      const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
      return [...this.state.turns.values()]
        .filter(
          (turn) => input.beforeAgentSeq === undefined || turn.agentSeq < input.beforeAgentSeq,
        )
        .sort((a, b) => b.agentSeq - a.agentSeq)
        .slice(0, limit)
        .map((turn) => freezeSnapshot(turnSnapshot(this.id, turn)));
    },
    events: async (
      turnId: string,
      input: EventReadInput = {},
      options: ReadOptions = {},
    ): Promise<readonly Snapshot<TurnEvent>[]> => {
      this.requireReadable(options);
      const limit = Math.min(Math.max(input.limit ?? 200, 1), 200);
      return eventWindow(turnEventsOf(this.eventsLog, this.state.turns, turnId), input, limit).map(
        (entry) => freezeSnapshot(entry),
      );
    },
    watch: (turnId: string, options: WatchOptions): AsyncIterable<Snapshot<TurnEvent>> =>
      this.watchTurn(turnId, options),
  };

  private requireReadable(options: ReadOptions = {}): void {
    if (options.signal?.aborted) {
      throw new ArcherError('ABORTED', '读取已取消');
    }
  }

  private async *watchTurn(
    turnId: string,
    options: WatchOptions,
  ): AsyncGenerator<Snapshot<TurnEvent>> {
    if (!this.state.turns.has(turnId)) {
      throw new ArcherError('NOT_FOUND', `Turn 不存在：${turnId}`, { turnId });
    }
    let cursor = options.afterSeq;
    while (true) {
      if (this.faultData) throw this.isolatedError();
      const batch = turnEventsOf(this.eventsLog, this.state.turns, turnId).filter(
        (entry) => entry.seq > cursor,
      );
      for (const entry of batch) {
        cursor = entry.seq;
        yield freezeSnapshot(entry);
        if (TERMINAL_TURN_FACTS.has(entry.type)) return;
      }
      const turn = this.state.turns.get(turnId);
      if (!turn) return;
      if (isTerminalTurnStatus(turn.status) && batch.length === 0) return;
      if (options.signal?.aborted) return;
      await this.waitForWake(options.signal);
    }
  }

  async *watchAgent(options: WatchOptions): AsyncGenerator<Snapshot<AgentEvent>> {
    let cursor = options.afterSeq;
    while (true) {
      if (this.faultData) throw this.isolatedError();
      const batch = this.eventsLog.filter((event) => event.seq > cursor);
      for (const event of batch) {
        cursor = event.seq;
        yield freezeSnapshot(event);
        if (event.fact.scope === 'agent' && event.fact.event.type === 'agent.removed') {
          return;
        }
      }
      if (this.state.removed && batch.length === 0) return;
      if (options.signal?.aborted) return;
      await this.waitForWake(options.signal);
    }
  }

  private waitForWake(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.resolve();
    if (this.faultData) return Promise.reject(this.isolatedError());
    return new Promise<void>((resolve, reject) => {
      if (this.faultData) {
        reject(this.isolatedError());
        return;
      }
      const wake = (): void => {
        this.wakeups.delete(wake);
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = (): void => {
        this.wakeups.delete(wake);
        resolve();
      };
      this.wakeups.add(wake);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  // ─────────────────────────────────────────────
  // 命令执行与人工交互
  // ─────────────────────────────────────────────

  private runCommands(commands: readonly SessionCommand[]): void {
    if (this.faultData || commands.length === 0) {
      return;
    }

    // Generator 保持命令顺序，执行时产生的后续命令追加到队尾。
    function* program(): Generator<SessionCommand, void, readonly SessionCommand[]> {
      const pending = [...commands];
      while (pending.length > 0) {
        const command = pending.shift()!;
        const followups = yield command;
        pending.push(...followups);
      }
    }

    const execution = run(program(), async (command) => {
      if (command.type === 'abort_effect') {
        this.inFlight.get(command.effectId)?.controller.abort();
        return [];
      }
      if (this.stopping || this.faultData) {
        return [];
      }
      return dispatchEffect(this.dispatchHost, command.effectId);
    })
      .catch((error: unknown) => this.isolate(error))
      .finally(() => {
        this.executions.delete(execution);
      });

    this.executions.add(execution);
  }

  private locateEffect(effectId: string): { turn: SessionTurn; effect: SessionEffect } | null {
    for (const turn of this.state.turns.values()) {
      const effect = turn.effects.find((candidate) => candidate.effectId === effectId);
      if (effect) return { turn, effect };
    }
    return null;
  }

  private pendingTarget(input: HumanTarget, kind: 'human' | 'reconcile'): SessionEffect {
    this.requireOpen();
    this.requireWritable();
    const turn = activeTurnOf(this.state);
    const effect = turn && turn.effects.at(-1);
    if (
      !turn ||
      turn.turnId !== input.turnId ||
      !effect ||
      effect.effectId !== input.effectId ||
      turn.pending?.kind !== kind
    ) {
      throw new ArcherError('CONFLICT', '待处理的 Turn 或 Effect 已经改变');
    }
    return effect;
  }

  async issueHumanToken(input: HumanTarget): Promise<HumanToken> {
    return this.withLock(async () => {
      this.pendingTarget(input, 'human');
      const token = randomBytes(32).toString('hex');
      const now = this.clock();
      const expiresAt = now + SUSPEND_TTL_MS;
      const decision = suspendEffectDecision(
        this.state,
        input.effectId,
        createHash('sha256').update(token).digest('hex'),
        expiresAt,
        { now },
      );
      if (!decision.ok) throw decision.error;
      await this.commit(decision.value);
      return { ...input, token, expiresAt };
    });
  }

  async reply(input: HumanReply): Promise<void> {
    const commands = await this.withLock(async () => {
      const effect = this.pendingTarget(input, 'human');
      const now = this.clock();
      const expected = Buffer.from(effect.suspended?.resumeTokenHash ?? '', 'hex');
      const actual = createHash('sha256').update(input.token).digest();
      if (
        !effect.suspended ||
        effect.suspended.expiresAt === undefined ||
        now >= effect.suspended.expiresAt ||
        expected.length !== actual.length ||
        !timingSafeEqual(expected, actual)
      ) {
        throw new ArcherError('CONFLICT', '人工凭证已过期或不匹配，请重新提交回答');
      }
      const decision = humanReplyDecision(
        this.state,
        input.effectId,
        input.approved,
        input.response,
        { ...this.decisionContext, now },
      );
      if (!decision.ok) throw decision.error;
      await this.commit(decision.value);
      return decision.value.commands;
    });
    this.runCommands(commands);
    await this.maybeConsumeQueue();
  }

  async reconcile(input: ReconcileInput): Promise<void> {
    const commands = await this.withLock(async () => {
      this.pendingTarget(input, 'reconcile');
      const decision = reconcileDecision(
        this.state,
        input.effectId,
        input.decision,
        this.decisionContext,
      );
      if (!decision.ok) throw decision.error;
      await this.commit(decision.value);
      return decision.value.commands;
    });
    this.runCommands(commands);
  }

  private async suspend(effectId: string): Promise<void> {
    await this.withLock(async () => {
      if (!this.admitted || this.faultData || this.stopping || this.state.removed) return;
      const located = this.locateEffect(effectId);
      if (
        !located ||
        located.effect.effect.type !== 'CALL' ||
        located.effect.effect.interaction !== 'human' ||
        located.turn.cancel
      ) {
        return;
      }
      const token = randomBytes(32);
      const hash = createHash('sha256').update(token).digest('hex');
      const now = this.clock();
      const decision = suspendEffectDecision(
        this.state,
        effectId,
        hash,
        now + SUSPEND_TTL_MS,
        { now },
      );
      if (!decision.ok) {
        if (decision.error.code === 'CONFLICT') return;
        throw decision.error;
      }
      await this.commit(decision.value);
    });
  }

  // ─────────────────────────────────────────────
  // 队列推进
  // ─────────────────────────────────────────────

  private async maybeConsumeQueue(): Promise<void> {
    const commands = await withPreparedPrompt(
      this.promptHost,
      () => {
        if (!this.admitted || this.faultData || this.stopping || this.state.removed) return false;
        return canConsumeQueuedInput(this.state);
      },
      async (promptFrame) => {
        if (!this.admitted || this.faultData || this.stopping || this.state.removed) return [];
        if (!promptFrame) return [];
        const decision = consumeQueuedDecision(this.state, promptFrame, this.decisionContext);
        if (!decision) return [];
        await this.commit(decision);
        return decision.commands;
      },
      false,
    );
    this.runCommands(commands);
  }
}
