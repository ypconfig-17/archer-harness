import { validateInput } from '@archer/contracts';
import type { EffectMiddleware } from './pipeline.js';

/** 人工交互工具先持久化等待，再结束本次驱动；不向 Generator 伪造完成结果。 */
export const withHumanInteraction: EffectMiddleware = (next) => async (effect, context) => {
  if (effect.type !== 'CALL' || effect.interaction !== 'human') return next(effect, context);
  if (!context.journal) throw new Error('Execution journal is required.');
  if (context.targetError || context.target?.metadata.interaction !== 'human') return next(effect, context);
  try { validateInput(context.target.metadata.inputSchema, effect.input); } catch { return next(effect, context); }
  await context.journal.suspend();
  return null;
};
