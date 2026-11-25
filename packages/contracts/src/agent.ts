/**
 * Archer Harness — Agent 规格协议
 */

import { z } from 'zod';
import { CapabilityRefSchema } from './provider.js';
import { JsonValueSchema } from './json-schema.js';

/** 回合内的一次动作计划 */
export const ActionPlanSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('call'), target: CapabilityRefSchema, input: JsonValueSchema, toolCallId: z.string(), toolName: z.string(), interaction: z.literal('human').optional() }),
]);
export type ActionPlan = z.infer<typeof ActionPlanSchema>;

/** 回合终止意图 */
export const TurnTerminalSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('done'), summary: z.string() }),
  z.strictObject({ kind: z.literal('respond'), content: z.string() }),
]);
export type TurnTerminal = z.infer<typeof TurnTerminalSchema>;
