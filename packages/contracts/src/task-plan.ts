/** 计划是模型声明；身份和版本用于区分独立计划与修订，不证明执行目标已完成。 */
import { z } from 'zod';

export const PlanStepSchema = z.object({
  text: z.string().trim().min(1).max(500),
  status: z.enum(['pending', 'in_progress', 'completed']),
}).strict();
const steps = z.array(PlanStepSchema).min(1).max(30).refine(
  value => value.filter(step => step.status === 'in_progress').length <= 1,
  'At most one stage may be in_progress.',
);
const identity = {
  planId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  title: z.string().trim().min(1).max(120),
  steps,
  explanation: z.string().max(2000).optional(),
};
export const TaskPlanSchema = z.object({
  ...identity,
  revision: z.number().int().positive().safe(),
}).strict();
export const PlanDeclarationSchema = z.object({
  ...identity,
  action: z.enum(['create', 'update']),
  expectedRevision: z.number().int().positive().safe().nullable(),
}).strict().refine(
  value => value.action === 'create' ? value.expectedRevision === null : value.expectedRevision !== null,
  'Create requires null expectedRevision; update requires the current revision.',
);
export type TaskPlan = z.infer<typeof TaskPlanSchema>;
export type PlanDeclaration = z.infer<typeof PlanDeclarationSchema>;
