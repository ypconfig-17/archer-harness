/**
 * Archer Harness — Agent 规格协议
 */

import { z } from 'zod';
import { CapabilityRefSchema } from './provider.js';
import { JsonValueSchema } from './json-schema.js';
import { InferConfigSchema } from './message.js';

/** SPAWN 控制意图携带的 Agent 规格；类型声明不表示执行器已支持 */
export const AgentSpecSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  identity: z.string().optional(),
  /** 持久化的纯决策策略标识；恢复时必须匹配宿主策略 */
  policyId: z.string().min(1).optional(),
  inferConfig: InferConfigSchema.optional(),
});
export type AgentSpec = z.infer<typeof AgentSpecSchema>;

/** 回合内的一次动作计划 */
export const ActionPlanSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('call'), target: CapabilityRefSchema, input: JsonValueSchema, toolCallId: z.string(), toolName: z.string(), interaction: z.literal('human').optional() }),
  z.strictObject({
    kind: z.literal('ask'),
    reason: z.string(),
    options: z.array(z.string()).optional(),
  }),
]);
export type ActionPlan = z.infer<typeof ActionPlanSchema>;

/** 回合终止意图 */
export const TurnTerminalSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('done'), summary: z.string() }),
  z.strictObject({ kind: z.literal('respond'), content: z.string() }),
]);
export type TurnTerminal = z.infer<typeof TurnTerminalSchema>;
