/** 参数、交互形态和 Shell 准入由 Runtime 固定保证，Provider 不接管决策。 */
import { validateInput } from '@archer/contracts';
import type { EffectMiddleware } from './pipeline.js';
export const withAuthorization: EffectMiddleware = next => async (effect, context) => {
  const reject = (code: string, message: string) => ({ status: 'failed' as const, error: { code, message } });
  if (effect.type === 'CALL_BATCH') {
    for (let i = 0; i < effect.calls.length; i += 1) {
      const error = context.batchErrors?.[i];
      if (error) return reject(error.code, error.message);
      const target = context.batchTargets?.[i];
      if (!target) return reject('EFFECT_UNSUPPORTED', 'Capability is unavailable.');
      if (target.metadata.execution !== 'read' || target.metadata.interaction === 'human') {
        return reject('PERMISSION_DENIED', 'CALL_BATCH only allows read-only non-interactive capabilities.');
      }
    }
    return next(effect, context);
  }
  if (effect.type !== 'CALL') return next(effect, context);
  if (context.targetError) return reject(context.targetError.code, context.targetError.message);
  const target = context.target;
  if (!target) return reject('EFFECT_UNSUPPORTED', 'Capability is unavailable.');
  if (target.metadata.interaction !== effect.interaction) return reject('PERMISSION_DENIED', 'Interaction declaration changed.');
  if (target.metadata.execution === 'shell' && !context.allowShell) return reject('PERMISSION_DENIED', 'Shell requires explicit turn authorization.');
  try { validateInput(target.metadata.inputSchema, effect.input); }
  catch (error) { return reject('INVALID_ARGUMENT', error instanceof Error ? error.message : String(error)); }
  return next(effect, context);
};
