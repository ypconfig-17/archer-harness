/** 结束复核只依赖已提交的文件变更回执与操作结果，不猜测命令含义。 */
import type { CallResult, JsonValue, JsonObject } from '@archer/contracts';
import type { SessionTurn } from './session.js';
function object(value: JsonValue | undefined): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}
export function completionReviewTarget(turn: SessionTurn): string | undefined {
  let target: string | undefined;
  for (const effect of turn.effects) {
    if (effect.effect.type !== 'CALL') continue;
    if (effect.status === 'completed') {
      const result = effect.result as CallResult;
      const change = object(object(object(result.value)?.metadata)?.fileChange);
      if (typeof change?.path === 'string' && typeof change.revisionAfter === 'string') target = effect.effectId;
      else if (target && result.isError) target = effect.effectId;
    } else if (target && effect.status === 'failed') target = effect.effectId;
  }
  return target;
}
