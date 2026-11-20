/**
 * 推理等级协议。
 *
 * 协议只声明完整等级集合；某次任务可用的子集由具体模型声明，
 * 非法等级不得静默降级。
 */
import { z } from 'zod';

export const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const ReasoningLevelSchema = z.enum(REASONING_LEVELS);
export type ReasoningLevel = z.infer<typeof ReasoningLevelSchema>;
