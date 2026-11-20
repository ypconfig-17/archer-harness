/**
 * Archer Harness — 消息与推理配置协议
 *
 * 这些结构会跨进程传输（HTTP / SSE），因此只允许包含
 * 可 JSON 序列化的字段。
 */

import { z } from 'zod';
import { ToolCallSchema } from './inference-tools.js';
import { ContextProfileSchema } from './context-profile.js';
import { ReasoningLevelSchema } from './reasoning.js';

/** 消息角色 */
export const MessageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

/** 推理端口回传需要的来源与原始文本分块，不作为系统指令。 */
export const ReasoningReplaySchema = z.object({
  provider: z.string().min(1), model: z.string().min(1), api: z.string().min(1),
  blocks: z.array(z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), signature: z.string().optional(), redacted: z.boolean().optional() }).strict().refine(block => block.end >= block.start)),
}).strict();

/** 图片以有界内联数据进入事实，不依赖临时路径或远程 URL。 */
export const ImageBlockSchema = z.strictObject({
  type: z.literal('image'),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  data: z.string().min(4).max(7_000_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
});
export type ImageBlock = z.infer<typeof ImageBlockSchema>;

/** 单条对话消息 */
export const MessageSchema = z.object({
  role: MessageRoleSchema,
  content: z.string(),
  images: z.array(ImageBlockSchema).optional(),
  toolCalls: z.array(ToolCallSchema).optional(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  isError: z.boolean().optional(),
  reasoning: z.string().optional(),
  reasoningReplay: ReasoningReplaySchema.optional(),
});
export type Message = z.infer<typeof MessageSchema>;

/** LLM 推理配置 */
export const InferConfigSchema = z.object({
  /** provider 路由键；存在多个路由时用于消除歧义 */
  provider: z.string().optional(),
  model: z.string().optional(),
  reasoning: ReasoningLevelSchema.optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().int().positive().optional(),
  /** 开始任务时固定的上下文管理快照；任务内后续推理沿用首个请求。 */
  contextProfile: ContextProfileSchema.optional(),
});
export type InferConfig = z.infer<typeof InferConfigSchema>;

/** 一次推理的 token 用量 */
export const TokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  /** 缓存读写是 promptTokens 的子集；未提供表示用量明细未知。 */
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;
