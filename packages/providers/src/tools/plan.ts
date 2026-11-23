/** 计划工具从本轮已提交历史校验版本，不在 Provider 内维护可变进度。 */
import {
  OperationRejected, PlanDeclarationSchema, TaskPlanSchema,
  type JsonObject, type OperationContext, type TaskPlan,
} from '@archer/contracts';
import { isRecord } from './input.js';
import { TOOL_PLAN_INVALID } from './prompt.js';

export function planResult(input: unknown, previous: readonly TaskPlan[] = []): JsonObject {
  const parsed = PlanDeclarationSchema.safeParse(input);
  if (!parsed.success) throw new OperationRejected(TOOL_PLAN_INVALID);
  const declaration = parsed.data;
  const latest = previous.at(-1);
  const existing = [...previous].reverse().find(plan => plan.planId === declaration.planId);
  // 新计划必须等待当前计划明确完成；修订只能作用于当前计划，旧计划不能被暗中复活。
  if (declaration.action === 'create') {
    if (existing) throw new OperationRejected('Plan ID already exists in this turn.', 'CONFLICT');
    if (latest?.steps.some(step => step.status !== 'completed')) {
      throw new OperationRejected('Complete the current plan before creating another plan.', 'CONFLICT');
    }
  } else if (!existing || latest?.planId !== declaration.planId || existing.revision !== declaration.expectedRevision) {
    throw new OperationRejected('Plan revision conflicts with the current committed plan.', 'CONFLICT');
  }
  const plan = TaskPlanSchema.parse({
    planId: declaration.planId,
    title: declaration.title,
    revision: declaration.action === 'create' ? 1 : declaration.expectedRevision! + 1,
    steps: declaration.steps,
    ...(declaration.explanation === undefined ? {} : { explanation: declaration.explanation }),
  });
  return {
    output: 'Plan declaration recorded. Step statuses are model declarations, not verification of external outcomes.',
    metadata: { plan },
  };
}

/** 只读取固定能力来源的成功结果；提交失败、未知及其他 Turn 不推进计划版本。 */
export function committedPlans(context: OperationContext): TaskPlan[] {
  if (!context.history || !context.call) {
    throw new OperationRejected('Plan declarations require committed turn history.', 'PERMISSION_DENIED');
  }
  const plans: TaskPlan[] = [];
  let offset: number | undefined;
  do {
    const page = context.history.list({ ...context.call, offset });
    for (const call of page.calls) {
      if (call.isError) continue;
      let content = '';
      let readOffset: number | undefined;
      do {
        const result = context.history.read({ turnId: context.call.turnId, callId: call.callId, offset: readOffset, limit: 8192 });
        content += result.content;
        readOffset = result.nextOffset;
        if (content.length > 131072) throw new OperationRejected('Committed plan exceeds the size limit.', 'CONFLICT');
      } while (readOffset !== undefined);
      const value: unknown = JSON.parse(content);
      const metadata = isRecord(value) ? value.metadata : undefined;
      const parsed = TaskPlanSchema.safeParse(isRecord(metadata) ? metadata.plan : undefined);
      if (!parsed.success) throw new OperationRejected('Committed plan format is invalid.', 'CONFLICT');
      plans.push(parsed.data);
    }
    offset = page.nextOffset;
  } while (offset !== undefined);
  return plans;
}
