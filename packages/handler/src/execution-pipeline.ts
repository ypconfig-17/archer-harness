/** Runtime 固定执行顺序的唯一装配入口，不开放可靠性包装的替换或重排。 */
import type { EffectExecutionRecord, EffectHandler } from './pipeline.js';
import { createDispatcher } from './pipeline.js';
import { withHumanInteraction } from './human-interaction.js';
import { withJournal } from './journal.js';
import { withAuthorization } from './authorization.js';
import { withAudit } from './audit.js';
import { executeInference } from './inference-pipeline.js';
import { call, callBatch } from './call.js';

export function createExecutionPipeline(onEffectExecuted?: (record: EffectExecutionRecord) => void): EffectHandler {
  return createDispatcher({ INFER: executeInference, CALL: call, CALL_BATCH: callBatch }, [
    withHumanInteraction,
    withJournal,
    withAuthorization,
    ...(onEffectExecuted ? [withAudit(onEffectExecuted)] : []),
  ]);
}
