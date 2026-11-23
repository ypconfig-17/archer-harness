/** 模型末端只调用固定能力、校验返回；提交由宿主包围实际调用。 */
import { InferResultSchema, type InferEffect, type InferResult } from '@archer/contracts';
import type { HandlerContext } from './pipeline.js';

export async function infer(effect: InferEffect, context: HandlerContext): Promise<InferResult> {
  const result = await context.inference.infer(effect, context.signal, context.onInferenceProgress);
  const parsed = InferResultSchema.safeParse(result);
  if (!parsed.success) throw new Error('Inference returned invalid result.');
  return parsed.data;
}
