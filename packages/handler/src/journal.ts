import type { EffectMiddleware } from './pipeline.js';

/** 提交执行窗口与结果；端口失败直接传播，绝不作为 provider 失败继续运行。 */
export const withJournal: EffectMiddleware = (next) => async (effect, context) => {
  if (!context.journal) throw new Error('Execution journal is required.');
  if (!await context.journal.begin()) return null;
  const outcome = await next(effect, context);
  if (outcome !== null) await context.journal.complete(outcome);
  return outcome;
};
