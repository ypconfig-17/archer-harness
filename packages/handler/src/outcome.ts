/** 能力执行结果的共同归类规则，不负责提交或重试。 */
import { JsonObjectSchema, type ErrorData } from '@archer/contracts';
import { EFFECT_OPERATION_CANCELLED, type SessionEffectOutcome } from '@archer/agent';
import type { HandlerContext } from './pipeline.js';

/** 从任意异常提取可提交的错误事实；非领域错误统一归为 PROVIDER_ERROR。 */
export function toErrorData(error: unknown): ErrorData {
  if (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && 'message' in error
    && typeof error.code === 'string'
    && typeof error.message === 'string'
  ) {
    const details = JsonObjectSchema.safeParse(
      'details' in error ? error.details : undefined,
    );
    return {
      code: error.code,
      message: error.message,
      ...(details.success ? { details: details.data } : {}),
    };
  }

  return {
    code: 'PROVIDER_ERROR',
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * 中止信号到达时的归类。
 *
 * 停止流程无法区分“未执行”与“已执行但结果未知”，返回 null 保留 started，
 * 交给恢复流程判定；普通取消发生在调用开始前，可以确认本次未执行。
 */
export function abortedOutcome(context: HandlerContext): SessionEffectOutcome | null {
  if (context.isStopping()) return null;
  return {
    status: 'cancelled',
    reason: EFFECT_OPERATION_CANCELLED,
  };
}

/** 能力已进入调用窗口但结果不可解释：不能断言写入失败。 */
export function unknownSideEffect(message: string): SessionEffectOutcome {
  return {
    status: 'unknown',
    error: { code: 'UNKNOWN_SIDE_EFFECT', message },
  };
}

export function elapsedMs(startedAt: number, context: HandlerContext): number {
  return Math.max(0, Math.trunc(context.now() - startedAt));
}

