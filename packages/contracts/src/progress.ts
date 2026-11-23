/** 临时推理进度没有日志序号；仅描述当前进程观察，不承诺跨重启恢复。 */
import { z } from 'zod';
export const InferenceChunkSchema = z.object({ content: z.string(), reasoning: z.string().optional() });
export type InferenceChunk = z.infer<typeof InferenceChunkSchema>;
export const InferenceProgressSchema = InferenceChunkSchema.extend({
  agentId: z.string(), turnId: z.string(), effectId: z.string(),
  phase: z.enum(['generating', 'settled', 'interrupted']),
});
export type InferenceProgress = z.infer<typeof InferenceProgressSchema>;
