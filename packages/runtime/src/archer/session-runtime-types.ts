/**
 * Archer Harness — SessionRuntime 共享类型与纯辅助函数
 */

import type {
  AgentEvent,
  AgentJournal,
  Camp,
  CapabilityRef,
  Effect,
  ErrorData,
  EventReadInput,
  JsonObject,
  KernelError,
  TurnEvent,
} from '@archer/contracts';
import { ArcherError, isJsonValue } from '@archer/contracts';
import type {
  SessionAgentPolicy,
  SessionCommand,
  SessionState,
  SessionTurn,
} from '@archer/agent';
import type { EffectExecutionRecord, EffectTarget } from '@archer/handler';

export const SUSPEND_TTL_MS = 24 * 60 * 60 * 1000;
export const TERMINAL_TURN_FACTS = new Set(['turn.completed', 'turn.failed', 'turn.cancelled']);
/** 仅用于进程内准备失效，不进入事件日志或公开错误协议。 */
export const STALE_PROMPT = Symbol('stale-prompt');

export interface PromptPreparation {
  seq: number;
  controller: AbortController;
  snapshot: Pick<SessionState, 'instructions' | 'workspace'>;
}

export interface Waiter {
  turnId: string;
  resolve(): void;
  reject(error: unknown): void;
}

export interface InFlight {
  controller: AbortController;
}

export interface Preflight extends EffectTarget {
  release: () => void;
}

export interface DispatchPlan {
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
export function turnFailure(turn: SessionTurn): ArcherError | null {
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
export function eventWindow<T extends { seq: number }>(
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

export function turnEventsOf(
  eventsLog: readonly AgentEvent[],
  turns: ReadonlyMap<string, SessionTurn>,
  turnId: string,
): TurnEvent[] {
  const result: TurnEvent[] = [];
  if (!turns.has(turnId)) return result;
  for (const event of eventsLog) {
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

function isArcherErrorLike(value: unknown): value is ErrorData {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

export function mapError(error: unknown): ErrorData {
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
