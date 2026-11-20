import type { EffectExecutionRecord, EffectMiddleware } from './pipeline.js';

/**
 * 把 handler 的执行结果交给观测回调。
 * @param sink - 调用方提供的遥测入口；不得在其中写入事件日志。
 * @returns 不改变执行结果的中间件。
 */
export function withAudit(
  sink: (record: EffectExecutionRecord) => void,
): EffectMiddleware {
  return (next) => async (effect, context) => {
    const startedAt = context.now();
    const outcome = await next(effect, context);
    try {
      sink({
        agentId: context.agentId,
        turnId: context.turnId,
        effectId: context.effectId,
        type: effect.type,
        status: outcome?.status ?? 'abandoned',
        durationMs: Math.max(0, context.now() - startedAt),
      });
    } catch {
      // 遥测失败不得影响已完成的执行事实
    }
    return outcome;
  };
}
