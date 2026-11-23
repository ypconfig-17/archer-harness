/**
 * Archer Harness — 统一数据校验
 *
 * 所有跨边界的数据都从这里进入或离开：
 *   - HTTP 请求体；
 *   - 持久化事件；
 *   - provider 返回值；
 *   - 事件 replay。
 *
 * 校验函数只返回显式结果或抛 ZodError，不在调用方重复拼 schema。
 */

import type { z } from 'zod';
import type { AgentEvent, TurnEvent } from './agent-session.js';
import type { EffectResultMap, EffectType } from './effect.js';
import { AgentEventSchema, TurnEventSchema } from './agent-session.js';
import {
  EFFECT_RESULT_SCHEMAS,
} from './effect.js';

/** 校验结果；失败时保留 ZodError，交给调用方映射成领域错误 */
export type Validation<T> =
  | { ok: true; value: T }
  | { ok: false; error: z.ZodError };

function validate<T>(schema: z.ZodType<T>, value: unknown): Validation<T> {
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: parsed.error };
}

/** 按 Effect 类型校验结果 */
export function validateEffectResult<T extends EffectType>(
  type: T,
  value: unknown,
): Validation<EffectResultMap[T]> {
  return validate(
    EFFECT_RESULT_SCHEMAS[type] as unknown as z.ZodType<EffectResultMap[T]>,
    value,
  );
}

/** 校验已提交的 Agent 事件 */
export function validateAgentEvent(value: unknown): Validation<AgentEvent> {
  return validate(AgentEventSchema, value);
}

/** 校验 Agent 日志中按 Turn 投影出的事件 */
export function validateTurnEvent(value: unknown): Validation<TurnEvent> {
  return validate(TurnEventSchema, value);
}

/** 列表查询的默认数量 */
export const DEFAULT_LIST_LIMIT = 50;

/** 列表查询的最大数量 */
export const MAX_LIST_LIMIT = 200;

/** Agent 事件窗口的最大数量 */
export const MAX_AGENT_EVENT_LIMIT = 500;

/**
 * 解析 `afterSeq` 查询参数。
 *
 * 非法输入（非数字、负数、Infinity）统一回退为 0；
 * 有效值向下取整，语义是“严格大于该 seq”。
 */
export function parseAfterSeqQuery(value: unknown): number {
  const raw = typeof value === 'string' ? Number(value) : 0;
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.trunc(raw);
}

/**
 * 解析 `limit` 查询参数。
 *
 * 非法输入回退为默认值；有效值夹在 [1, max]。
 */
export function parseLimitQuery(
  value: unknown,
  fallback: number = DEFAULT_LIST_LIMIT,
  max: number = MAX_LIST_LIMIT,
): number {
  // 空串和纯空白不能走 Number('') → 0 的路径，否则会被夹成 1。
  const hasValue = typeof value === 'string' && value.trim() !== '';
  const raw = hasValue ? Number(value) : fallback;
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(Math.trunc(raw), 1), max);
}

/** 校验并返回 AgentEvent；失败抛 ZodError */
export function parseAgentEvent(value: unknown): AgentEvent {
  return AgentEventSchema.parse(value);
}
