import { committedHistory } from './history.js';
import { compileModelTools } from '../prompt/model-tools.js';
import { INFERENCE, INFERENCE_PREPARE } from '@archer/camp';
import { resolveCall } from '../execution/targets.js';
import { workspaceFiles } from '@archer/providers';
import { KernelErrorSchema, assertJsonValue, validateInput, canonicalJson } from '@archer/contracts';
import { automaticallyApproved } from '../execution/command-approval.js';
/**
 * Archer Harness — 单个 Agent 的串行提交与执行
 *
 * 所有事实先经纯决策生成草稿，提交成功后才执行命令。
 * 每个 Agent 一把提交锁；Effect 执行在锁外进行，结果回到锁内收束。
 */

import { run } from '@archer/kernel';
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
  ErrorData,
  EventReadInput,
  JsonObject,
  KernelError,
  PromptOptions,
  ReadOptions,
  Snapshot,
  SteerOptions,
  SubmitOptions,
  FollowUpOptions,
  TurnEvent,
  TurnLimits,
  TurnRef,
  TurnSnapshot,
  WaitOptions,
  WatchOptions,
  Effect,
  InferenceChunk,
  InferenceProgress,
  HumanTarget,
  HumanToken,
  HumanReply,
  ReconcileInput,
} from '@archer/contracts';
import {
  InferenceChunkSchema,
  AgentInputSchema,
  ArcherError,
  TurnLimitsSchema,
  InferConfigSchema,
  freezeSnapshot,
  isJsonValue,
  isTerminalTurnStatus,
} from '@archer/contracts';
import type { Camp, CapabilityRef } from '@archer/contracts';
import type { EffectTarget } from '@archer/handler';
import type { AcceptedInput, SessionCommand, SessionDecision, SessionEffect, SessionState, SessionAgentPolicy, SessionContext, SessionTurn } from '@archer/agent';
import { abortDecision, acceptInputDecision, beginEffectDecision, canConsumeQueuedInput, clearQueueDecision, consumeQueuedDecision, effectOutcomeDecision, previewInputAcceptance, recoverDecision, removeDecision, renameDecision, resumeQueueDecision, configureExecutionDecision, steerDecision, suspendEffectDecision, humanReplyDecision, reconcileDecision } from '../execution/session-step.js';
import { DraftBuilder, activeTurnOf, agentSnapshot, compileTurnPrompt, turnSnapshot, type PromptFrame, type SessionEffectOutcome } from '@archer/agent';
import type { EffectExecutionRecord, EffectHandler } from '@archer/handler';
import { createExecutionPipeline, ExecutionCommitError } from '@archer/handler';

const SUSPEND_TTL_MS = 24 * 60 * 60 * 1000;
const TERMINAL_TURN_FACTS = new Set(['turn.completed', 'turn.failed', 'turn.cancelled']);
/** 仅用于进程内准备失效，不进入事件日志或公开错误协议。 */
const STALE_PROMPT = Symbol('stale-prompt');

interface PromptPreparation {
  seq: number;
  controller: AbortController;
  snapshot: Pick<SessionState, 'instructions' | 'workspace'>;
}

interface Waiter {
  turnId: string;
  resolve(): void;
  reject(error: unknown): void;
}

interface InFlight {
  controller: AbortController;
}

interface Preflight extends EffectTarget { release: () => void }

interface DispatchPlan {
  authorizationRevision: number;
  effectId: string;
  turnId: string;
  effect: Effect;
  preflight: Preflight | null;
  preflightError: KernelError | null;
  controller: AbortController;
  commands: SessionCommand[];
}

export interface SessionRuntimeOptions {
  /** 显式纯决策策略，身份必须与会话创建事实匹配 */
  agentPolicy?: SessionAgentPolicy;
  state: SessionState;
  events: readonly AgentEvent[];
  journal: AgentJournal;
  inference: CapabilityRef;
  camp: Camp;
  preparations: readonly CapabilityRef[];
  clock: () => number;
  onError: (error: ArcherError) => void;
  /** 执行层观测回调；不得写入事件日志 */
  onEffectExecuted?: (record: EffectExecutionRecord) => void;
}

/** 终态 Turn 对应的公开错误；非终态返回 null */
function turnFailure(turn: SessionTurn): ArcherError | null {
  if (turn.status === 'failed') {
    return new ArcherError(
      'TURN_FAILED',
      turn.error?.message ?? `Turn 失败：${turn.turnId}`,
      {
        turnId: turn.turnId,
        ...(turn.error?.code ? { errorCode: turn.error.code } : {}),
      },
    );
  }
  if (turn.status === 'cancelled') {
    return new ArcherError(
      'TURN_CANCELLED',
      turn.error?.message ?? `Turn 已取消：${turn.turnId}`,
      { turnId: turn.turnId },
    );
  }
  return null;
}

/** 增量窗口与历史窗口互斥；历史窗口保留目标序号之前最近的一页。 */
function eventWindow<T extends { seq: number }>(
  entries: readonly T[],
  input: EventReadInput,
  limit: number,
): T[] {
  if (input.beforeSeq !== undefined && input.afterSeq !== undefined) {
    throw new ArcherError('INVALID_ARGUMENT', 'beforeSeq 与 afterSeq 不能同时使用');
  }
  if (input.beforeSeq !== undefined) {
    if (!Number.isSafeInteger(input.beforeSeq) || input.beforeSeq <= 0) {
      throw new ArcherError('INVALID_ARGUMENT', 'beforeSeq 必须为正整数');
    }
    return entries.filter((entry) => entry.seq < input.beforeSeq!).slice(-limit);
  }
  const afterSeq = input.afterSeq ?? 0;
  return entries.filter((entry) => entry.seq > afterSeq).slice(0, limit);
}

function isArcherErrorLike(value: unknown): value is ErrorData {
  return (
    typeof value === 'object'
    && value !== null
    && typeof (value as { code?: unknown }).code === 'string'
    && typeof (value as { message?: unknown }).message === 'string'
  );
}

function mapError(error: unknown): ErrorData {
  if (error instanceof ArcherError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    };
  }
  if (isArcherErrorLike(error)) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details && isJsonValue(error.details)
        ? { details: error.details as JsonObject }
        : {}),
    };
  }
  return {
    code: 'INTERNAL',
    message: error instanceof Error ? error.message : String(error),
  };
}

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
  private readonly progressListeners = new Set<(progress: Snapshot<InferenceProgress> | null) => void>();

  private readonly agentPolicy?: SessionAgentPolicy;

  private get decisionContext(): SessionContext {
    return { now: this.clock(), agentPolicy: this.agentPolicy };
  }

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
    for (const preparation of this.promptPreparations) preparation.controller.abort(this.isolatedError());
    const reported = error instanceof ArcherError
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

  private async commit(decision: SessionDecision, preparationAbortReason: unknown = STALE_PROMPT): Promise<AgentEvent[]> {
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
        error instanceof ArcherError
        && (error.code === 'COMMIT_UNKNOWN' || error.code === 'EVENT_LOG_CORRUPT')
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
    for (const preparation of this.promptPreparations) preparation.controller.abort(preparationAbortReason);
    this.eventsLog.push(...committed);
    if (this.state.removed) for (const listener of this.progressListeners) listener(null);
    if (this.latestProgress?.phase === 'generating') {
      const effect = this.locateEffect(this.latestProgress.effectId)?.effect;
      if (effect && ['completed', 'failed', 'cancelled', 'unknown'].includes(effect.status)) {
        this.latestProgress = freezeSnapshot({ ...this.latestProgress, phase: effect.status === 'completed' ? 'settled' : 'interrupted' });
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
      if (
        event.fact.scope === 'turn'
        && TERMINAL_TURN_FACTS.has(event.fact.event.type)
      ) {
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
    const inference = options.inference === undefined ? undefined : InferConfigSchema.safeParse(options.inference);
    if (inference && !inference.success) throw new ArcherError('INVALID_ARGUMENT', '推理配置不合法');
    const requestId = options.requestId ?? randomUUID();
    const allowShell = options.allowShell === true;
    const commandMode = options.commandMode ?? 'ask';
    if (!['ask', 'auto', 'full'].includes(commandMode)) throw new ArcherError('INVALID_ARGUMENT', '命令模式不合法');
    let commands: SessionCommand[] = [];
    let turnId: string | null = null;

    const base: Omit<AcceptedInput, 'promptFrame'> = {
      command, requestId, input: parsedInput, allowShell, commandMode,
      ...(limits ? { limits } : {}),
      ...(inference?.success ? { inference: inference.data } : {}),
    };
    await this.withPreparedPrompt(() => {
      this.requireOpen();
      this.requireWritable();
      const preview = previewInputAcceptance(this.state, base);
      if (!preview.ok) throw preview.error;
      return preview.value.startsTurn;
    }, async promptFrame => {
      const accepted: AcceptedInput = { ...base, ...(promptFrame ? { promptFrame } : {}) };
      const decision = acceptInputDecision(this.state, accepted, this.decisionContext);
      if (!decision.ok) throw decision.error;
      commands = decision.value.decision.commands;
      turnId = decision.value.turnId;
      await this.commit(decision.value.decision);
    });

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
      const decision = steerDecision(this.state, parsedInput, {
        requestId,
        ...(options.turnId !== undefined ? { turnId: options.turnId } : {}),
      }, this.decisionContext);
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
      const decision = abortDecision(this.state, {
        requestId,
        ...(options.turnId !== undefined ? { turnId: options.turnId } : {}),
        ...(options.reason !== undefined ? { reason: options.reason } : {}),
      }, this.decisionContext);
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

  async configureExecution(expectedRevision: number, workspaceAccess?: import('@archer/contracts').Workspace['access'], commandAuthorization?: import('@archer/contracts').ConfigureExecutionInput['commandAuthorization']): Promise<void> {
    const commands = await this.withLock(async () => {
      this.requireWritable();
      const now = this.clock();
      const approval = commandAuthorization?.approveCommand;
      if (approval) {
        // 凭证只用于进程内校验，不写入配置事实；同一锁内固定原任务与命令。
        const effect = this.pendingTarget({ turnId: commandAuthorization.turnId, effectId: approval.effectId }, 'human');
        const expected = Buffer.from(effect.suspended?.resumeTokenHash ?? '', 'hex');
        const actual = createHash('sha256').update(approval.token).digest();
        if (!effect.suspended || effect.suspended.expiresAt === undefined || now >= effect.suspended.expiresAt
          || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
          throw new ArcherError('CONFLICT', '人工凭证已过期或不匹配，请重新确认');
        }
      }
      const decision = configureExecutionDecision(this.state, expectedRevision, workspaceAccess, commandAuthorization, { ...this.decisionContext, now });
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
    const commands = await this.withPreparedPrompt(() => {
      if (this.state.removed || this.stopping || this.faultData) return false;
      return canConsumeQueuedInput(this.state);
    }, async promptFrame => {
      if (this.state.removed || this.stopping || this.faultData) return [];
      const decision = recoverDecision(this.state, promptFrame ?? { prefix: [], tools: [], preparations: [] }, this.decisionContext);
      await this.commit(decision);
      return decision.commands;
    }, false, signal);
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
      if (!located || (located.effect.status !== 'created' && located.effect.status !== 'resumed')) {
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
    const listener = (progress: Snapshot<InferenceProgress> | null) => { pending = progress; wake?.(); };
    const abort = () => wake?.();
    this.progressListeners.add(listener);
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      while (!options.signal?.aborted && this.admitted && !this.state.removed) {
        if (pending) { const frame = pending; pending = null; yield frame; }
        else await new Promise<void>(resolve => { wake = resolve; });
      }
    } finally {
      this.progressListeners.delete(listener);
      options.signal?.removeEventListener('abort', abort);
    }
  }

  private publishProgress(plan: DispatchPlan, chunk: InferenceChunk, phase: InferenceProgress['phase'] = 'generating'): void {
    if (plan.effect.type !== 'INFER' || !this.admitted) return;
    if (phase === 'generating' && (this.inFlight.get(plan.effectId)?.controller !== plan.controller || this.locateEffect(plan.effectId)?.effect.status !== 'started')) return;
    const parsed = InferenceChunkSchema.safeParse(chunk);
    if (!parsed.success) return;
    const frame = freezeSnapshot({ ...parsed.data, agentId: this.id, turnId: plan.turnId, effectId: plan.effectId, phase });
    // 临时通道诊断只观察实际发布时机，不改变锁、提交或慢消费者合并规则。
    const diagnostics = channel('archer.stream');
    if (diagnostics.hasSubscribers) diagnostics.publish({ stage: 'Runtime', agentId: this.id,
      effectId: plan.effectId, event: phase, content: frame.content.length, reasoning: frame.reasoning?.length ?? 0 });
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
      agentSnapshot(this.state, this.lastCommittedAt, this.currentExecution, this.faultData ?? undefined),
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
        request.command !== 'prompt'
        && request.command !== 'send'
        && request.command !== 'followUp'
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
          (turn) =>
            input.beforeAgentSeq === undefined || turn.agentSeq < input.beforeAgentSeq,
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
      return eventWindow(this.turnEvents(turnId), input, limit).map((entry) => freezeSnapshot(entry));
    },
    watch: (turnId: string, options: WatchOptions): AsyncIterable<Snapshot<TurnEvent>> =>
      this.watchTurn(turnId, options),
  };

  private requireReadable(options: ReadOptions = {}): void {
    if (options.signal?.aborted) {
      throw new ArcherError('ABORTED', '读取已取消');
    }
  }

  private turnEvents(turnId: string): TurnEvent[] {
    const result: TurnEvent[] = [];
    if (!this.state.turns.has(turnId)) return result;
    for (const event of this.eventsLog) {
      if (event.fact.scope !== 'turn' || event.fact.turnId !== turnId) continue;
      result.push({
        id: event.id,
        agentId: event.agentId,
        turnId,
        agentSeq: event.seq,
        seq: event.fact.turnSeq,
        ts: event.ts,
        ...event.fact.event,
      });
    }
    return result;
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
      const batch = this.turnEvents(turnId).filter((entry) => entry.seq > cursor);
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
  // Prompt 编译
  // ─────────────────────────────────────────────

  /** 锁内选择事实版本，锁外准备；提交前校验版本，失效结果不进入事实。 */
  private async withPreparedPrompt<T>(
    needsPrompt: () => boolean,
    apply: (frame: PromptFrame | undefined) => Promise<T>,
    inputRequest = true,
    parentSignal?: AbortSignal,
  ): Promise<T> {
    for (;;) {
      const selected = await this.withLock(async (): Promise<{ result: T } | { preparation: PromptPreparation }> => {
        if (!needsPrompt()) return { result: await apply(undefined) };
        const preparation: PromptPreparation = {
          seq: this.state.seq,
          controller: new AbortController(),
          snapshot: structuredClone({ instructions: this.state.instructions, workspace: this.state.workspace }),
        };
        this.promptPreparations.add(preparation);
        return { preparation };
      });
      if ('result' in selected) return selected.result;
      const preparation = selected.preparation;
      const signal = AbortSignal.any([this.lifecycle.signal, preparation.controller.signal, ...(parentSignal ? [parentSignal] : [])]);
      try {
        const frame = await this.preparePrompt(preparation, signal);
        const applied = await this.withLock(async (): Promise<{ result: T } | { retry: true }> => {
          this.promptPreparations.delete(preparation);
          if (signal.aborted) throw signal.reason;
          if (this.state.seq !== preparation.seq) return { retry: true };
          // 状态未变仍重做准入检查，避免停止或隔离后接收迟到的输入。
          if (!needsPrompt()) return { retry: true };
          // 编译完成且事实重验后固定准备能力及其输入。
          const preparations = this.preparations.map(ref => {
            this.camp.resolve(ref, INFERENCE_PREPARE);
            const item = this.camp.list(INFERENCE_PREPARE).find(item => canonicalJson(item.ref) === canonicalJson(ref));
            if (!item) throw new Error('Preparation capability is unavailable.');
            return { ref, input: structuredClone(item.metadata.input), ...(item.metadata.order === undefined ? {} : { order: item.metadata.order }) };
          }).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || canonicalJson(a.ref).localeCompare(canonicalJson(b.ref)));
          const preparedFrame = { ...frame, preparations };
          return { result: await apply(preparedFrame) };
        });
        if ('result' in applied) return applied.result;
      } catch (error) {
        if (signal.aborted) {
          if (parentSignal?.aborted) throw new ArcherError('ABORTED', '恢复准备已取消');
          if (signal.reason === STALE_PROMPT || !inputRequest) continue;
          if (signal.reason instanceof ArcherError) throw signal.reason;
          throw new ArcherError('ABORTED', '输入准备已取消');
        }
        throw error;
      } finally {
        this.promptPreparations.delete(preparation);
      }
    }
  }

  /** 调用方可提前停止等待；实际准备工作仍跟踪到结束，保护租约与共享依赖。 */
  private preparePrompt(preparation: PromptPreparation, signal: AbortSignal): Promise<PromptFrame> {
    if (signal.aborted) return Promise.reject(signal.reason);
    const task = this.promptFrame(preparation, signal);
    this.preparationTasks.add(task);
    void task.then(() => this.preparationTasks.delete(task), () => this.preparationTasks.delete(task));
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      void task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }

  /** 只使用捕获的会话快照编译工具，准备过程不持有提交锁。 */
  private async promptFrame(preparation: PromptPreparation, signal: AbortSignal): Promise<PromptFrame> {
    const check = () => { if (signal.aborted) throw signal.reason; };
    check();
    const snapshot = preparation.snapshot;
    const tools = compileModelTools(this.camp);
    check();
    const frame = compileTurnPrompt({
      instructions: snapshot.instructions,
      workspace: snapshot.workspace,
    });
    check();
    return { ...frame, tools, inference: this.inference };
  }

  // ─────────────────────────────────────────────
  // 命令执行
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
      return this.dispatch(command.effectId);
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
    if (!turn || turn.turnId !== input.turnId || !effect || effect.effectId !== input.effectId || turn.pending?.kind !== kind) throw new ArcherError('CONFLICT', '待处理的 Turn 或 Effect 已经改变');
    return effect;
  }

  async issueHumanToken(input: HumanTarget): Promise<HumanToken> {
    return this.withLock(async () => {
      this.pendingTarget(input, 'human');
      const token = randomBytes(32).toString('hex');
      const now = this.clock();
      const expiresAt = now + SUSPEND_TTL_MS;
      const decision = suspendEffectDecision(this.state, input.effectId, createHash('sha256').update(token).digest('hex'), expiresAt, { now });
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
      if (!effect.suspended || effect.suspended.expiresAt === undefined || now >= effect.suspended.expiresAt || expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new ArcherError('CONFLICT', '人工凭证已过期或不匹配，请重新提交回答');
      const decision = humanReplyDecision(this.state, input.effectId, input.approved, input.response, { ...this.decisionContext, now });
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
      const decision = reconcileDecision(this.state, input.effectId, input.decision, this.decisionContext);
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
      if (!located || (located.effect.effect.type !== 'ASK_HUMAN' && !(located.effect.effect.type === 'CALL' && located.effect.effect.interaction === 'human')) || located.turn.cancel) return;
      const token = randomBytes(32);
      const hash = createHash('sha256').update(token).digest('hex');
      const now = this.clock();
      const decision = suspendEffectDecision(this.state, effectId, hash, now + SUSPEND_TTL_MS, { now });
      if (!decision.ok) {
        if (decision.error.code === 'CONFLICT') return;
        throw decision.error;
      }
      await this.commit(decision.value);
    });
  }

  private async dispatch(effectId: string): Promise<SessionCommand[]> {
    const plan = await this.withLock(async () => this.prepareDispatch(effectId));
    if (!plan) return [];
    try {
      if (plan.effect.type === 'CALL' && plan.preflight) {
        try {
          validateInput(plan.preflight.metadata.inputSchema, plan.effect.input);
        } catch (error) {
          const parsed = KernelErrorSchema.safeParse(error);
          plan.preflightError = parsed.success ? parsed.data : { code: 'PROVIDER_ERROR', message: error instanceof Error ? error.message : String(error) };
        }
        if (!await this.approveCommand(plan)) return [];
      }
      await this.perform(plan);
      await this.maybeConsumeQueue();
      return plan.commands;
    } finally {
      if (this.latestProgress?.effectId === plan.effectId && this.latestProgress.phase === 'generating') {
        const effect = this.locateEffect(plan.effectId)?.effect;
        this.publishProgress(plan, this.latestProgress, effect?.status === 'completed' ? 'settled' : 'interrupted');
      }
      plan.preflight?.release();
      this.inFlight.delete(effectId);
    }
  }

  /** 能力已固定到本次执行；这里只检查当前事实并提交命令等待。 */
  private async approveCommand(plan: DispatchPlan): Promise<boolean> {
    return this.withLock(async () => {
      const located = this.locateEffect(plan.effectId);
      if (!located || this.stopping || this.faultData || located.turn.cancel
        || !['created', 'resumed'].includes(located.effect.status)) return false;
      const { turn, effect } = located;
      if (effect.effect.type === 'CALL' && !plan.preflightError && plan.preflight?.metadata.execution === 'shell'
        && turn.allowShell && !effect.commandApproved && turn.commandMode !== 'full'
        && !(turn.commandMode === 'auto' && automaticallyApproved(effect.effect.input, process.platform))) {
        const now = this.clock();
        const hash = createHash('sha256').update(randomBytes(32)).digest('hex');
        const decision = suspendEffectDecision(this.state, plan.effectId, hash, now + SUSPEND_TTL_MS, { now });
        if (!decision.ok) throw decision.error;
        await this.commit(decision.value);
        return false;
      }
      plan.authorizationRevision = this.state.executionRevision;
      return true;
    });
  }

  private async prepareDispatch(effectId: string): Promise<DispatchPlan | null> {
    if (!this.admitted || this.faultData || this.stopping || this.state.removed) return null;
    if (this.inFlight.has(effectId)) return null;

    const located = this.locateEffect(effectId);
    if (!located) return null;
    const { turn, effect } = located;
    if (turn.turnId !== this.state.activeTurnId) return null;
    if (effect.status !== 'created' && effect.status !== 'resumed') return null;

    let preflight: Preflight | null = null;
    let preflightError: KernelError | null = null;
    try {
      if (effect.effect.type === 'CALL') {
        const target = resolveCall(this.camp, effect.effect);
        preflight = { ...target, release: this.camp.acquire() };
      } else if (effect.effect.type === 'INFER') this.camp.resolve(effect.effect.target, INFERENCE);
    } catch (error) {
      if (error instanceof ArcherError && error.code === 'CAPABILITY_UNAVAILABLE') { this.blocked.add(effectId); return null; }
      preflightError = { code: 'PROVIDER_ERROR', message: error instanceof Error ? error.message : String(error) };
    }

    this.blocked.delete(effectId);

    const controller = new AbortController();
    this.inFlight.set(effectId, { controller });

    return {
      effectId,
      authorizationRevision: this.state.executionRevision,
      turnId: turn.turnId,
      effect: effect.effect,
      preflight,
      preflightError,
      controller,
      commands: [],
    };
  }

  /** 包装器通过此端口在串行边界内提交开始与结果，始终只有一个日志写入方。 */
  private executionJournal(plan: DispatchPlan) {
    return {
      begin: () => this.withLock(async () => {
        if (!this.admitted || this.stopping || this.faultData || this.state.removed) return false;
        // 授权在准入与开始提交之间改变时，重新准入尚未开始的操作。
        if (plan.authorizationRevision !== this.state.executionRevision) {
          plan.commands.push({ type: 'dispatch_effect', effectId: plan.effectId });
          return false;
        }
        const decision = beginEffectDecision(this.state, plan.effectId, this.decisionContext);
        if (!decision.ok) {
          if (decision.error.code === 'CONFLICT') return false;
          throw decision.error;
        }
        await this.commit(decision.value);
        return true;
      }),
      complete: (outcome: SessionEffectOutcome) => this.withLock(async () => {
        if (this.faultData) return;
        const decision = effectOutcomeDecision(this.state, plan.effectId, outcome, this.decisionContext);
        if (!decision.ok) {
          if (decision.error.code === 'CONFLICT') return;
          throw decision.error;
        }
        await this.commit(decision.value);
        plan.commands.push(...decision.value.commands);
      }),
      suspend: () => this.suspend(plan.effectId),
    };
  }

  /** 每个真实模型请求先提交实际输入，确认响应后再交回 Handler；提交异常不能被误归类。 */
  private async executeModelRequest(plan: DispatchPlan, request: import('@archer/contracts').InferEffect,
    purpose: 'agent' | 'compaction', execute: () => Promise<import('@archer/contracts').InferResult>) {
    const commitFact = async (build: (builder: DraftBuilder) => void) => this.withLock(async () => {
      if (this.faultData) throw new ExecutionCommitError(new ArcherError('CONFLICT', '会话已隔离，不能继续提交模型请求'));
      const builder = new DraftBuilder(this.state);
      build(builder);
      try { await this.commit(builder.finish()); } catch (error) { throw new ExecutionCommitError(error); }
    });
    let requestId = '';
    await commitFact(builder => {
      const located = this.locateEffect(plan.effectId);
      if (!located || located.effect.status !== 'started' || this.stopping || plan.controller.signal.aborted) throw new Error('模型请求已失效');
      requestId = `${plan.effectId}:request:${located.effect.inferenceRequests.length + 1}`;
      builder.turn(plan.turnId, { type: 'inference.requested', data: { effectId: plan.effectId, requestId, purpose, request, requestedAt: this.clock() } });
    });
    // 请求指纹关联 Provider 本次调用；requestId 仍是正式事实中的响应关联标识。
    const diagnostics = channel('archer.stream');
    if (diagnostics.hasSubscribers) diagnostics.publish({ stage: 'Request', agentId: this.id,
      effectId: plan.effectId, requestId, purpose,
      responseId: createHash('sha256').update(canonicalJson(JSON.parse(JSON.stringify(request)))).digest('hex').slice(0, 16), event: 'start' });
    let result: import('@archer/contracts').InferResult;
    try {
      if (plan.controller.signal.aborted) throw new Error('Inference was cancelled before invocation.');
      result = await execute();
    } catch (error) {
      // 停止时保留已开始且未确认的请求；不把未知用量记为零。
      if (!this.stopping) await commitFact(builder => {
        builder.turn(plan.turnId, { type: 'inference.request.failed', data: { effectId: plan.effectId, requestId,
          error: { code: 'PROVIDER_ERROR', message: error instanceof Error ? error.message : String(error) }, failedAt: this.clock() } });
      });
      throw error;
    }
    await commitFact(builder => {
      builder.turn(plan.turnId, { type: 'inference.responded', data: { effectId: plan.effectId, requestId, result, respondedAt: this.clock() } });
    });
    return { requestId, attempt: this.locateEffect(plan.effectId)!.effect.attempt, purpose, request, status: 'completed' as const, result };
  }

  /** 采用摘要只追加事实；摘要必须对应已经确认的模型响应。 */
  private async commitCompaction(plan: DispatchPlan, requestId: string, coveredMessageCount: number) {
    return this.withLock(async () => {
      if (this.faultData || this.stopping || plan.controller.signal.aborted) throw new ArcherError('CONFLICT', '摘要准备已失效');
      const effect = this.locateEffect(plan.effectId)?.effect;
      const request = effect?.inferenceRequests.find(item => item.requestId === requestId);
      if (!request?.result) throw new ArcherError('CONFLICT', '摘要响应尚未确认');
      const existing = this.state.compactions.find(item => item.requestId === requestId);
      if (existing) return existing;
      const builder = new DraftBuilder(this.state);
      builder.turn(plan.turnId, { type: 'context.compacted', data: { effectId: plan.effectId, requestId, coveredMessageCount, summary: request.result.content, compactedAt: this.clock() } });
      try { await this.commit(builder.finish()); } catch (error) { throw new ExecutionCommitError(error); }
      return this.state.compactions.at(-1)!;
    });
  }

  private async perform(plan: DispatchPlan): Promise<SessionEffectOutcome | null> {
    const effect = plan.effect;
    const snapshot = committedHistory(this.state);
    return this.effectPipeline(effect, {
      history: snapshot.history,
      executionFacts: snapshot.facts,
      agentId: this.state.agentId,
      turnId: plan.turnId,
      effectId: plan.effectId,
      tokenBudget: this.state.turns.get(plan.turnId)?.limits.tokenBudget,
      inferenceHistory: this.state.turns.get(plan.turnId)?.effects.flatMap(item => item.inferenceRequests) ?? [],
      effectRequests: this.locateEffect(plan.effectId)?.effect.inferenceRequests ?? [],
      compactions: this.state.compactions,
      executeInference: (request, purpose, execute) => this.executeModelRequest(plan, request, purpose, execute),
      commitCompaction: (requestId, coveredMessageCount) => this.commitCompaction(plan, requestId, coveredMessageCount),
      signal: plan.controller.signal,
      now: this.clock,
      inference: plan.effect.type === 'INFER' ? this.camp.resolve(plan.effect.target, INFERENCE) : this.camp.resolve(this.inference, INFERENCE),
      onInferenceProgress: chunk => {
        if (!plan.controller.signal.aborted && !this.stopping && !this.faultData) this.publishProgress(plan, chunk);
      },
      journal: this.executionJournal(plan),
      allowShell: this.state.turns.get(plan.turnId)?.allowShell === true,
      workspace: this.state.workspace,
      files: this.state.workspace ? workspaceFiles(this.state.workspace, plan.controller.signal) : undefined,
      prepare: async request => {
        const implementation = this.camp.resolve(request.ref, INFERENCE_PREPARE);
        const files = this.state.workspace ? workspaceFiles(this.state.workspace, plan.controller.signal) : undefined;
        const value = await implementation.prepare(structuredClone(request.input), {
          signal: plan.controller.signal, workspace: this.state.workspace,
          inference: plan.effect.type === 'INFER' ? freezeSnapshot({ messages: plan.effect.messages, ...(plan.effect.config ? { config: plan.effect.config } : {}) }) : undefined,
          files: files ? { ...files, write: async () => { throw new Error('Read-only preparation cannot write files.'); } } : undefined,
        });
        assertJsonValue(value, 'Preparation result');
        return freezeSnapshot(value);
      },
      target: plan.preflight,
      targetError: plan.preflightError,
      isStopping: () => this.stopping,
    });
  }

  // ─────────────────────────────────────────────
  // 队列推进
  // ─────────────────────────────────────────────

  private async maybeConsumeQueue(): Promise<void> {
    const commands = await this.withPreparedPrompt(() => {
      if (!this.admitted || this.faultData || this.stopping || this.state.removed) return false;
      return canConsumeQueuedInput(this.state);
    }, async promptFrame => {
      if (!this.admitted || this.faultData || this.stopping || this.state.removed) return [];
      if (!promptFrame) return [];
      const decision = consumeQueuedDecision(this.state, promptFrame, this.decisionContext);
      if (!decision) return [];
      await this.commit(decision);
      return decision.commands;
    }, false);
    this.runCommands(commands);
  }
}
