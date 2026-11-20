/** 当前 Agent 的已提交模型可见工具结果，只提供有界只读分页。 */
import { z } from 'zod';
import { CapabilityRefSchema } from './provider.js';
export const HistoryReadInputSchema = z.object({
  turnId: z.string().min(1).optional(), callId: z.string().min(1),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(8192).optional(),
}).strict();
export type HistoryReadInput = z.infer<typeof HistoryReadInputSchema>;
export interface HistoryPage {
  turnId: string; callId: string; content: string; totalChars: number; offset: number;
  nextOffset?: number; isError: boolean;
}
/** 按精确来源分页列举已提交结果，不提供执行、写入或跨 Agent 查询。 */
export const HistoryListInputSchema = z.object({
  turnId: z.string().min(1),
  target: CapabilityRefSchema,
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(128).optional(),
}).strict();
export type HistoryListInput = z.infer<typeof HistoryListInputSchema>;
export interface HistoryCallPage {
  calls: { callId: string; isError: boolean }[];
  nextOffset?: number;
}
export interface HistoryReader {
  read(input: HistoryReadInput): HistoryPage;
  list(input: HistoryListInput): HistoryCallPage;
}
