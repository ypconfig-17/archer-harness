/**
 * Archer Harness — 领域错误协议
 *
 * KernelError 会进入事件并跨进程传输，因此定义在 contracts。
 * kernel 只 re-export，不维护第二份定义。
 */

import { z } from 'zod';

/** 领域错误码 */
export const KernelErrorCodeSchema = z.enum([
  'PATH_INVALID',
  'NOT_FOUND',
  'NOT_A_FILE',
  'PARENT_NOT_FOUND',
  'PARENT_NOT_A_DIRECTORY',
  'PERMISSION_DENIED',
  'REVISION_CONFLICT',
  'ALREADY_EXISTS',
  'EFFECT_UNSUPPORTED',
  'PROVIDER_ERROR',
  'UNKNOWN_SIDE_EFFECT',
  'RESUME_TOKEN_INVALID',
  'RESUME_TOKEN_EXPIRED',
  'EVENT_LOG_CORRUPT',
  'UNSUPPORTED_EVENT',
  'INTERNAL',
]);
export type KernelErrorCode = z.infer<typeof KernelErrorCodeSchema>;

/** 可序列化的领域错误 */
export const KernelErrorSchema = z.object({
  code: KernelErrorCodeSchema,
  message: z.string(),
  retryable: z.boolean().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type KernelError = z.infer<typeof KernelErrorSchema>;

/** 纯函数统一使用的显式结果类型；失败不抛异常 */
export type Result<T, E = KernelError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** 构造成功结果 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** 构造失败结果 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
