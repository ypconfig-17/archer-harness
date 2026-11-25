/** Agent 执行意图；CALL 执行工具或技能加载，INFER 执行模型推理。 */
import { z } from 'zod';
import { InferenceToolSchema, ToolCallSchema } from './inference-tools.js';
import { PreparationSchema, CapabilityRefSchema } from './provider.js';
import { JsonValueSchema } from './json-schema.js';
import { ErrorDataSchema } from './archer-error.js';
import { InferConfigSchema, MessageSchema, TokenUsageSchema, ReasoningReplaySchema } from './message.js';
import { ReasoningLevelSchema } from './reasoning.js';
import { ContextStepKindSchema } from './context-profile.js';

// ─────────────────────────────────────────────
// Effect 定义
// ─────────────────────────────────────────────

/** 请求 LLM 推理 */
export const InferEffectSchema = z.object({
  type: z.literal('INFER'),
  target: CapabilityRefSchema,
  messages: z.array(MessageSchema),
  tools: z.array(InferenceToolSchema).optional(),
  preparations: z.array(PreparationSchema).optional(),
  /** 本次 INFER 固定前缀的消息数；0 明确表示没有固定前缀。 */
  promptPrefixCount: z.number().int().nonnegative(),
  /** 仅统计会话历史投影，不表示模型实际 token 用量或完整请求窗口。 */
  contextProjection: z.object({ originalChars: z.number().int().nonnegative(), projectedChars: z.number().int().nonnegative(), summarizedMessages: z.number().int().nonnegative() }).strict().optional(),
  config: InferConfigSchema.optional(),
}).refine(effect => effect.promptPrefixCount <= effect.messages.length, {
  path: ['promptPrefixCount'], message: 'Prompt prefix exceeds message count.',
});

/** 执行工具或技能加载；工具映射与参数来自已提交的推理结果。 */
export const CallEffectSchema = z.object({
  type: z.literal('CALL'),
  target: CapabilityRefSchema,
  input: JsonValueSchema,
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  interaction: z.literal('human').optional(),
});
export type CallEffect = z.infer<typeof CallEffectSchema>;
export const CallResultSchema = z.object({
  value: JsonValueSchema,
  /** 能力已返回确定结果，但操作报告错误，例如命令非零退出。 */
  isError: z.boolean().optional(),
  /** Runtime 按 Tool 声明投影的模型正文；缺省由 Agent 序列化 value。 */
  modelContent: z.string().optional(),
});
export type CallResult = z.infer<typeof CallResultSchema>;

/** 并发只读批次中的单项调用 */
export const CallBatchItemSchema = z.object({
  target: CapabilityRefSchema,
  input: JsonValueSchema,
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
});
export type CallBatchItem = z.infer<typeof CallBatchItemSchema>;

/** 并发执行多个只读且非人工交互的能力调用 */
export const CallBatchEffectSchema = z.object({
  type: z.literal('CALL_BATCH'),
  calls: z.array(CallBatchItemSchema).min(2),
});
export type CallBatchEffect = z.infer<typeof CallBatchEffectSchema>;

export const CallBatchItemResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('completed'), result: CallResultSchema }),
  z.object({ status: z.literal('failed'), error: ErrorDataSchema }),
]);
export type CallBatchItemResult = z.infer<typeof CallBatchItemResultSchema>;

export const CallBatchResultSchema = z.object({
  results: z.array(CallBatchItemResultSchema),
});
export type CallBatchResult = z.infer<typeof CallBatchResultSchema>;

export const EffectSchema = z.discriminatedUnion('type', [
  InferEffectSchema,
  CallEffectSchema,
  CallBatchEffectSchema,
]);

export type InferEffect = z.infer<typeof InferEffectSchema>;
export type Effect = z.infer<typeof EffectSchema>;
export type EffectType = Effect['type'];

/** Effect 生命周期状态；Agent 折叠规则据此校验事实完整性 */
export const EFFECT_STATUSES = [
  'created',
  'started',
  'suspended',
  'resumed',
  'completed',
  'failed',
  'cancelled',
  'unknown',
] as const;

export const EffectStatusSchema = z.enum(EFFECT_STATUSES);
export type EffectStatus = z.infer<typeof EffectStatusSchema>;

/** Effect 类型字符串常量集合 */
export const EFFECT_TYPES = [
  'INFER',
  'CALL',
  'CALL_BATCH',
] as const;

export const EffectTypeSchema = z.enum(EFFECT_TYPES);

// ─────────────────────────────────────────────
// Effect 结果（全部可序列化）
// ─────────────────────────────────────────────

/** 当次模型窗口准入记录，完整请求与估算方法随事实保存。 */
export const ContextWindowSchema = z.object({
  estimatedInputTokens: z.number().int().nonnegative(),
  inputLimit: z.number().int().nonnegative(),
  outputReserve: z.number().int().positive(),
  safetyMargin: z.number().int().nonnegative(),
  method: z.string().min(1),
}).strict();

/** 一次实际整理记录；只保存已执行步骤，未命中步骤可由 Profile 链还原。 */
export const CONTEXT_STEP_REASONS = ['capacity', 'growth', 'overflow'] as const;
export const ContextPlanStepSchema = z.strictObject({
  stepId: z.string().min(1),
  kind: ContextStepKindSchema,
  reason: z.enum(CONTEXT_STEP_REASONS),
  beforeTokens: z.number().int().nonnegative(),
  afterTokens: z.number().int().nonnegative(),
}).strict();
export type ContextPlanStep = z.infer<typeof ContextPlanStepSchema>;

/** 本次推理实际采用的 Profile 快照与整理收益，用于界面核对生效配置。 */
export const ContextPlanSchema = z.strictObject({
  profileId: z.string().min(1),
  profileName: z.string().min(1),
  profileRevision: z.number().int().positive(),
  beforeTokens: z.number().int().nonnegative(),
  afterTokens: z.number().int().nonnegative(),
  inputLimit: z.number().int().nonnegative(),
  steps: z.array(ContextPlanStepSchema),
}).strict();
export type ContextPlan = z.infer<typeof ContextPlanSchema>;

export const InferResultSchema = z.object({
  content: z.string(),
  /** 原生推理端口保留实际停止原因；无此信息的本地实现可省略。 */
  stopReason: z.enum(['stop', 'toolUse', 'length']).optional(),
  toolCalls: z.array(ToolCallSchema).optional(),
  preparations: z.array(PreparationSchema.extend({ value: JsonValueSchema })).optional(),
  /** 仅保存 provider 实际返回的 reasoning，不由 UI 或 Agent 推测。 */
  reasoning: z.string().optional(),
  reasoningReplay: ReasoningReplaySchema.optional(),
  /** 本次端口请求实际选择的等级。 */
  reasoningLevel: ReasoningLevelSchema.optional(),
  usage: TokenUsageSchema.optional(),
  contextWindow: ContextWindowSchema.optional(),
  contextPlan: ContextPlanSchema.optional(),
});
export type InferResult = z.infer<typeof InferResultSchema>;

/** Effect 类型到其结果类型的映射 */
export interface EffectResultMap {
  INFER: InferResult;
  CALL: CallResult;
  CALL_BATCH: CallBatchResult;
}

/** 获取给定 Effect 的结果类型 */
export type EffectResult<E extends Effect> = EffectResultMap[E['type']];

/** 每种 Effect 的结果校验器；dispatch 与 replay 边界共用 */
export const EFFECT_RESULT_SCHEMAS = {
  INFER: InferResultSchema,
  CALL: CallResultSchema,
  CALL_BATCH: CallBatchResultSchema,
} as const satisfies Record<EffectType, z.ZodType>;
