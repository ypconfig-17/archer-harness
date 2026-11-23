/**
 * Archer Harness — 公开错误协议
 *
 * ArcherError 同时用于进程内调用与跨进程传输；
 * 错误码描述调用边界，不代替领域事件中的 Turn / Effect 状态。
 */

import { z } from 'zod';
import type { JsonObject } from './json.js';
import { JsonObjectSchema } from './json-schema.js';

export const ARCHER_ERROR_CODES = [
  'INVALID_ARGUMENT',
  'ARCHER_NOT_RUNNING',
  'ARCHER_FAILED',
  'NOT_FOUND',
  'PERMISSION_DENIED',
  'CONFLICT',
  'CAPABILITY_UNAVAILABLE',
  'AGENT_ISOLATED',
  'EVENT_LOG_CORRUPT',
  'COMMIT_UNKNOWN',
  'TURN_FAILED',
  'TURN_CANCELLED',
  'SHUTDOWN_TIMEOUT',
  'ABORTED',
  'INTERNAL',
] as const;

export type ArcherErrorCode = (typeof ARCHER_ERROR_CODES)[number];

/** 可 JSON 序列化的错误事实；事件与快照共用 */
export interface ErrorData {
  readonly code: string;
  readonly message: string;
  readonly details?: JsonObject;
}

export const ErrorDataSchema: z.ZodType<ErrorData> = z.object({
  code: z.string().min(1),
  message: z.string(),
  details: JsonObjectSchema.optional(),
});

/** 公开 API 的领域错误 */
export class ArcherError extends Error {
  readonly code: ArcherErrorCode;
  readonly details?: JsonObject;

  constructor(code: ArcherErrorCode, message: string, details?: JsonObject) {
    super(message);
    this.name = 'ArcherError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/** 判断任意异常是否为公开领域错误 */
export function isArcherError(value: unknown): value is ArcherError {
  return value instanceof ArcherError;
}
