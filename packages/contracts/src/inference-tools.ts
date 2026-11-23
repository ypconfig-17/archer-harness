/** 模型工具定义与内部能力引用；推理适配器只发送名称、说明及参数。 */
import { z } from 'zod';
import { CapabilityRefSchema } from './provider.js';
import { JsonValueSchema } from './json-schema.js';
export const InferenceToolSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/), target: CapabilityRefSchema,
  description: z.string(), parameters: z.record(z.string(), JsonValueSchema),
  interaction: z.literal('human').optional(), wrappedInput: z.boolean().optional(),
}).strict();
export type InferenceTool = z.infer<typeof InferenceToolSchema>;
export const ToolCallSchema = z.object({ id: z.string().min(1), name: z.string().min(1), input: JsonValueSchema,
  signature: z.string().optional(), namespace: z.string().optional(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;
