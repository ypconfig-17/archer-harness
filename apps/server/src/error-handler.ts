/**
 * Archer Harness — 统一错误映射
 *
 * 只把公开领域错误映射为 HTTP 状态；未知异常不回传内部细节。
 */

import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { ArcherError, OperationRejected, type ArcherErrorCode } from '@archer/contracts';

const STATUS_BY_CODE: Partial<Record<ArcherErrorCode, number>> = {
  INVALID_ARGUMENT: 400,
  PERMISSION_DENIED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ABORTED: 408,
  TURN_CANCELLED: 409,
  TURN_FAILED: 422,
  AGENT_ISOLATED: 409,
  ARCHER_NOT_RUNNING: 503,
  CAPABILITY_UNAVAILABLE: 503,
  SHUTDOWN_TIMEOUT: 503,
  EVENT_LOG_CORRUPT: 500,
  COMMIT_UNKNOWN: 500,
  ARCHER_FAILED: 500,
  INTERNAL: 500,
};

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: '请求参数不合法',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    if (error instanceof ArcherError) {
      return reply.code(STATUS_BY_CODE[error.code] ?? 500).send({
        error: error.message,
        code: error.code,
      });
    }

    // 能力明确拒绝时保留其错误码；只读预览直接调用 Tool，不经过 Handler 的错误归类。
    if (error instanceof OperationRejected) {
      const code = error.code as ArcherErrorCode;
      return reply.code(STATUS_BY_CODE[code] ?? 400).send({ error: error.message, code: error.code });
    }

    request.log.error(error);
    return reply.code(500).send({ error: '服务器内部错误' });
  });
}
