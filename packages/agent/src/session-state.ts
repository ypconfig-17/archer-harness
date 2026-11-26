/**
 * Archer Harness — Agent 会话状态与只读投影
 *
 * 定义 SessionState、Turn、Effect 等内存投影结构及请求签名规则，
 * 不包含事件折叠逻辑与外部 I/O。
 */

import type {
  ActionPlan,
  AgentSnapshot,
  Effect,
  EffectResult,
  EffectStatus,
  ErrorData,
  InferConfig,
  Message,
  PendingInput,
  QueuedInput,
  TurnLimits,
  TurnSnapshot,
  TurnStatus,
  TurnTerminal,
} from '@archer/contracts';
import { isTerminalTurnStatus } from '@archer/contracts';

// ─────────────────────────────────────────────
// 状态结构
// ─────────────────────────────────────────────

export interface SessionLimits {
  maxInferenceSteps?: number;
  tokenBudget?: number;
}

/** 每次真实模型请求独立留痕；未确认请求的用量保持未知。 */
export interface SessionInferenceRequest {
  requestId: string;
  attempt: number;
  purpose: 'agent' | 'compaction';
  request: import('@archer/contracts').InferEffect;
  status: 'requested' | 'completed' | 'failed';
  result?: import('@archer/contracts').InferResult;
  error?: ErrorData;
}

export interface SessionCompaction {
  effectId: string;
  requestId: string;
  coveredMessageCount: number;
  summary: string;
}

export interface SessionEffect {
  effectId: string;
  effect: Effect;
  idempotencyKey: string;
  inferenceStep: number;
  status: EffectStatus;
  attempt: number;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  result?: EffectResult<Effect>;
  error?: ErrorData;
  reason?: string;
  commandApproved?: boolean;
  inferenceRequests: SessionInferenceRequest[];
  suspended?: {
    reason: string;
    resumeTokenHash: string;
    expiresAt?: number;
  };
  unknown?: { detectedAt: number };
  /** 人工放弃追踪不改变 unknown 的外部结果事实。 */
  abandoned?: { reason: string; at: number };
}

export interface SessionPlan {
  actions: ActionPlan[];
  nextIndex: number;
  terminal?: TurnTerminal;
}

export interface SessionTurn {
  turnId: string;
  /** turn.created 事件的 Agent seq */
  agentSeq: number;
  /** 该 Turn 子序列的最后序号 */
  seq: number;
  inputId: string;
  status: TurnStatus;
  commandMode?: import('@archer/contracts').CommandMode;
  allowShell: boolean;
  inference?: InferConfig;
  limits: SessionLimits;
  createdAt: number;
  inferenceSteps: number;
  /** 最近一次已经提交结束复核的操作边界，避免同一状态无限追问。 */
  completionReviewAfter?: string;
  plan: SessionPlan | null;
  effects: SessionEffect[];
  pending: PendingInput | null;
  cancel: { reason?: string; requestedAt: number } | null;
  stopReason?: 'done' | 'respond';
  summary?: string;
  error?: ErrorData;
  completedAt?: number;
}

export type RequestCommand =
  | 'prompt'
  | 'send'
  | 'followUp'
  | 'steer'
  | 'abort'
  | 'resumeQueue'
  | 'clearQueue';

export interface SessionRequest {
  command: RequestCommand;
  signature: string;
  inputId?: string;
  turnId?: string;
}

/** 队列中的输入保留提交时固化的执行选项 */
export interface SessionQueuedInput extends QueuedInput {
  commandMode?: import('@archer/contracts').CommandMode;
  allowShell: boolean;
  inference?: InferConfig;
  limits?: TurnLimits;
}

export interface SessionState {
  workspace?: import('@archer/contracts').Workspace;
  /** 恢复时校验的纯决策策略标识 */
  policyId: string;
  agentId: string;
  seq: number;
  createdAt: number;
  /** 规范化创建声明的摘要；用于 create 幂等判定 */
  createKey: string;
  /** 用户确认的会话标题；未重命名时缺省 */
  title?: string;
  instructions: string;
  inference: InferConfig;
  executionRevision: number;
  messages: Message[];
  compactions: SessionCompaction[];
  queue: SessionQueuedInput[];
  queuePaused: boolean;
  pendingSteering: Array<QueuedInput & { turnId: string }>;
  activeTurnId: string | null;
  turns: Map<string, SessionTurn>;
  requests: Map<string, SessionRequest>;
  /** 已接收输入总数；用于生成稳定的 inputId */
  inputCount: number;
  removed: boolean;
  removedAt?: number;
}

// ─────────────────────────────────────────────
// 构造与只读投影
// ─────────────────────────────────────────────

export function activeTurnOf(state: SessionState): SessionTurn | null {
  return state.activeTurnId === null ? null : state.turns.get(state.activeTurnId) ?? null;
}

export function lastEffectOf(turn: SessionTurn): SessionEffect | null {
  return turn.effects.at(-1) ?? null;
}

export function hasPendingEffect(turn: SessionTurn): boolean {
  const effect = lastEffectOf(turn);
  if (!effect) return false;
  return (
    effect.status === 'created' ||
    effect.status === 'started' ||
    effect.status === 'resumed' ||
    effect.status === 'suspended' ||
    effect.status === 'unknown'
  );
}

export function isTurnActive(turn: SessionTurn | null): boolean {
  return turn !== null && !isTerminalTurnStatus(turn.status);
}

export function turnSnapshot(agentId: string, turn: SessionTurn): TurnSnapshot {
  return {
    agentId,
    turnId: turn.turnId,
    agentSeq: turn.agentSeq,
    createdAt: turn.createdAt,
    seq: turn.seq,
    allowShell: turn.allowShell,
    commandMode: turn.commandMode ?? 'ask',
    status: turn.status,
    pending: turn.pending,
    ...(turn.error ? { error: turn.error } : {}),
  };
}

export function agentSnapshot(
  state: SessionState,
  updatedAt: number,
  execution: AgentSnapshot['execution'] = 'ready',
  fault?: ErrorData,
): AgentSnapshot {
  const active = activeTurnOf(state);
  return {
    id: state.agentId,
    createdAt: state.createdAt,
    updatedAt,
    ...(state.title ? { title: state.title } : {}),
    seq: state.seq,
    activeTurnId: state.activeTurnId,
    queuePaused: state.queuePaused,
    workspace: state.workspace,
    instructions: state.instructions,
    inference: state.inference,
    executionRevision: state.executionRevision,
    messages: state.messages,
    queuedInputs: state.queue.map(({ inputId, requestId, input }) => ({
      inputId,
      requestId,
      input,
    })),
    pendingSteering: state.pendingSteering,
    activeTurn: active ? turnSnapshot(state.agentId, active) : null,
    execution,
    ...(fault ? { fault } : {}),
  };
}

// ─────────────────────────────────────────────
// 请求签名
// ─────────────────────────────────────────────

export function requestSignature(
  command: string,
  input: unknown,
  options: {
    commandMode?: import('@archer/contracts').CommandMode;
    allowShell?: boolean;
    limits?: TurnLimits;
    inference?: InferConfig;
    turnId?: string;
  } = {},
): string {
  return JSON.stringify([
    command,
    normalizedJson(input),
    options.allowShell === true,
    options.commandMode ?? 'ask',
    options.limits?.maxInferenceSteps ?? null,
    options.limits?.tokenBudget ?? null,
    options.turnId ?? null,
    normalizedJson(options.inference ?? null),
  ]);
}

function normalizedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizedJson);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      result[key] = normalizedJson(record[key]);
    }
    return result;
  }
  return value;
}
