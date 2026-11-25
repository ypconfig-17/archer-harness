/**
 * 上下文管理 Profile 协议。
 *
 * Profile 只是声明式配置：有序步骤、每步参数与可选触发条件。
 * 是否触发、如何整理以及安全边界全部由 Handler 决定；UI 只编辑和展示同一份结构。
 */
import { z } from 'zod';
import { ReasoningLevelSchema } from './reasoning.js';

/** 条件可读取的上下文指标；全部来自本地估算快照，不调用模型。 */
export const CONTEXT_METRICS = [
  'inputRatio',
  'estimatedInputTokens',
  'uncoveredTokens',
  'historyMessages',
] as const;
export const ContextMetricSchema = z.enum(CONTEXT_METRICS);
export type ContextMetric = z.infer<typeof ContextMetricSchema>;

export const CONTEXT_OPERATORS = ['gte', 'gt', 'lte', 'lt'] as const;
export const ContextOperatorSchema = z.enum(CONTEXT_OPERATORS);
export type ContextOperator = z.infer<typeof ContextOperatorSchema>;

/** 一次比较；任一指标缺失（例如模型不支持计量）时不成立。 */
export interface ContextCompareCondition {
  kind: 'compare';
  metric: ContextMetric;
  op: ContextOperator;
  value: number;
}

/** ALL 组合：全部子条件成立；子项允许继续嵌套。 */
export interface ContextAllCondition {
  kind: 'all';
  conditions: ContextCondition[];
}

/** ANY 组合：任一子条件成立。 */
export interface ContextAnyCondition {
  kind: 'any';
  conditions: ContextCondition[];
}

/** ANY / ALL 递归组合，允许嵌套表达复合触发条件。 */
export type ContextGroupCondition = ContextAllCondition | ContextAnyCondition;

export type ContextCondition = ContextCompareCondition | ContextGroupCondition;

/** 在解析阶段限制深度，避免无界递归先耗尽调用栈，再执行事后校验。 */
function conditionSchema(depth: number): z.ZodType<ContextCondition> {
  const child = depth < 4
    ? conditionSchema(depth + 1)
    : z.custom<ContextCondition>(() => false, { message: '触发条件最多嵌套 4 层。' });
  const conditions = z.array(child)
    .min(1, '条件组至少包含一项。')
    .max(8, '单个条件组最多包含 8 项。');
  return z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('compare'),
      metric: ContextMetricSchema,
      op: ContextOperatorSchema,
      value: z.number().finite().nonnegative('条件数值不能为负数。'),
    }),
    z.strictObject({ kind: z.literal('all'), conditions }),
    z.strictObject({ kind: z.literal('any'), conditions }),
  ]);
}

export const ContextConditionSchema = conditionSchema(1);

/** 摘要步骤参数；绝对值在运行时还会受可用输入窗口比例上限约束。 */
export const ContextCompactParamsSchema = z.strictObject({
  /** 容量线：完整输入超过 inputLimit - min(reserveTokens, 15% inputLimit) 时触发。 */
  reserveTokens: z.number().int('预留量必须是整数。').min(0, '预留量不能小于 0。').max(1_000_000, '预留量不能超过 1,000,000。'),
  /** 增长线：未被已采用摘要覆盖的历史估算超过该值时触发。 */
  growthTokens: z.number().int('增长阈值必须是整数。').min(1, '增长阈值必须大于 0。').max(1_000_000, '增长阈值不能超过 1,000,000。'),
  /** 摘要后仍需保留的近期原文目标；实际不超过输入窗口的 25%。 */
  keepRecentTokens: z.number().int('保护量必须是整数。').min(1, '保护量必须大于 0。').max(1_000_000, '保护量不能超过 1,000,000。'),
  /** 摘要请求输出预算；0 表示按模型窗口自动取值。 */
  summaryBudgetTokens: z.union([
    z.literal(0),
    z.number().int('摘要预算必须是整数。').min(1_024, '摘要预算至少 1,024，或使用 0 表示自动。').max(65_536, '摘要预算不能超过 65,536。'),
  ]),
  /** 摘要请求的推理等级；缺省沿用任务等级。 */
  reasoning: ReasoningLevelSchema.optional(),
}).strict();
export type ContextCompactParams = z.infer<typeof ContextCompactParamsSchema>;

/** 工具结果节选参数；完整输入超过输入额度 85% 时启动，不能代替窗口准入。 */
export const ContextTrimParamsSchema = z.strictObject({
  /** 以整理前完整输入为分母的最小节省比例；低于该值保持原文。 */
  minSavingsRatio: z.number().min(0.05, '节选收益下限不能低于 0.05。').max(0.75, '节选收益下限不能高于 0.75。'),
}).strict();
export type ContextTrimParams = z.infer<typeof ContextTrimParamsSchema>;

const StepIdSchema = z.string().min(1, '步骤标识不能为空。').max(64, '步骤标识不能超过 64 个字符。')
  .regex(/^[a-z0-9][a-z0-9-]*$/, '步骤标识只能使用小写字母、数字和连字符。');

export const CONTEXT_STEP_KINDS = ['compact', 'trim-tool-results'] as const;
export const ContextStepKindSchema = z.enum(CONTEXT_STEP_KINDS);
export type ContextStepKind = z.infer<typeof ContextStepKindSchema>;

export const ContextStepSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('compact'),
    id: StepIdSchema,
    enabled: z.boolean(),
    /** 附加过滤条件；缺省表示只按步骤自身的触发线执行。 */
    when: ContextConditionSchema.optional(),
    params: ContextCompactParamsSchema,
  }),
  z.strictObject({
    kind: z.literal('trim-tool-results'),
    id: StepIdSchema,
    enabled: z.boolean(),
    when: ContextConditionSchema.optional(),
    params: ContextTrimParamsSchema,
  }),
]);
export type ContextStep = z.infer<typeof ContextStepSchema>;

/** 配置结构版本；不兼容变更时递增，并同步更新校验与界面。 */
export const CONTEXT_PROFILE_VERSION = 1;

// 所有入口复用完整校验，步骤 ID 同时是运行时阻塞键，重复会改变调度语义。
export const ContextProfileSchema = z.strictObject({
  version: z.literal(CONTEXT_PROFILE_VERSION),
  id: z.string().min(1, 'Profile 标识不能为空。').max(64, 'Profile 标识不能超过 64 个字符。')
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Profile 标识只能使用小写字母、数字和连字符。'),
  name: z.string().min(1, 'Profile 名称不能为空。').max(80, 'Profile 名称不能超过 80 个字符。'),
  description: z.string().max(240, 'Profile 描述不能超过 240 个字符。'),
  /** 同一 Profile 每次保存递增，事实与界面据此识别实际使用的版本。 */
  revision: z.number().int().positive(),
  /** 大窗口模型的实用工作区封顶上限（token）；缺省表示不额外封顶，仅按模型窗口比例触发。 */
  targetWindowTokens: z.number().int('工作区上限必须是整数。').min(16_384, '工作区上限不能低于 16,384。').max(1_000_000, '工作区上限不能超过 1,000,000。').optional(),
  steps: z.array(ContextStepSchema).min(1, '至少保留一个步骤。').max(8, '策略链最多包含 8 个步骤。'),
}).superRefine((profile, context) => {
  const ids = new Set<string>();
  let enabledTrims = 0;
  for (const [index, step] of profile.steps.entries()) {
    if (ids.has(step.id)) {
      context.addIssue({ code: 'custom', path: ['steps', index, 'id'], message: `步骤标识重复：${step.id}。` });
    }
    ids.add(step.id);
    if (step.kind === 'trim-tool-results' && step.enabled) enabledTrims += 1;
    if (step.when && compareCount(step.when) > 24) {
      context.addIssue({ code: 'custom', path: ['steps', index, 'when'], message: '单个步骤最多包含 24 个比较条件。' });
    }
  }
  if (enabledTrims > 1) {
    context.addIssue({ code: 'custom', path: ['steps'], message: '最多启用一个工具结果节选步骤；多余的节选没有额外收益。' });
  }
});
export type ContextProfile = z.infer<typeof ContextProfileSchema>;

/** 处理步骤时的本地指标快照；不包含任何模型调用。 */
export interface ContextMetrics {
  estimatedInputTokens: number;
  inputLimit: number;
  /** 未被已采用摘要覆盖的历史估算；缺少计量能力时为 undefined。 */
  uncoveredTokens?: number;
  /** 不包括固定前缀的会话消息数。 */
  historyMessages: number;
}

export function cloneContextProfile(profile: ContextProfile): ContextProfile {
  return JSON.parse(JSON.stringify(profile)) as ContextProfile;
}

const BUILTIN_PROFILES: readonly ContextProfile[] = [
  {
    version: 1,
    id: 'quality',
    name: '上下文质量优先',
    description: '更早整理旧历史，保留更多近期原文，并为摘要启用高推理等级。',
    revision: 1,
    targetWindowTokens: 200_000,
    steps: [
      {
        kind: 'trim-tool-results',
        id: 'trim-tool-results',
        enabled: true,
        params: { minSavingsRatio: 0.2 },
      },
      {
        kind: 'compact',
        id: 'compact-history',
        enabled: true,
        params: {
          reserveTokens: 24_000,
          growthTokens: 60_000,
          keepRecentTokens: 40_000,
          summaryBudgetTokens: 16_384,
          reasoning: 'high',
        },
      },
    ],
  },
  {
    version: 1,
    id: 'balanced',
    name: '均衡模式',
    description: '按默认阈值整理，摘要预算按模型窗口自动取值。',
    revision: 1,
    targetWindowTokens: 160_000,
    steps: [
      {
        kind: 'trim-tool-results',
        id: 'trim-tool-results',
        enabled: true,
        params: { minSavingsRatio: 0.25 },
      },
      {
        kind: 'compact',
        id: 'compact-history',
        enabled: true,
        params: {
          reserveTokens: 16_384,
          growthTokens: 100_000,
          keepRecentTokens: 20_000,
          summaryBudgetTokens: 0,
        },
      },
    ],
  },
  {
    version: 1,
    id: 'token-saver',
    name: 'Token 优化优先',
    description: '更早整理并压缩摘要预算，优先降低长会话的输入成本。',
    revision: 1,
    targetWindowTokens: 100_000,
    steps: [
      {
        kind: 'trim-tool-results',
        id: 'trim-tool-results',
        enabled: true,
        params: { minSavingsRatio: 0.15 },
      },
      {
        kind: 'compact',
        id: 'compact-history',
        enabled: true,
        params: {
          reserveTokens: 32_000,
          growthTokens: 40_000,
          keepRecentTokens: 12_000,
          summaryBudgetTokens: 8_192,
          reasoning: 'low',
        },
      },
    ],
  },
];

export const BUILTIN_CONTEXT_PROFILE_IDS = BUILTIN_PROFILES.map(profile => profile.id);
export const DEFAULT_CONTEXT_PROFILE_ID = 'balanced';

export function isBuiltinContextProfile(id: string): boolean {
  return BUILTIN_PROFILES.some(profile => profile.id === id);
}

/** 内置 Profile 始终返回副本，调用方不能修改共享模板。 */
export function builtinContextProfile(id: string): ContextProfile | undefined {
  const profile = BUILTIN_PROFILES.find(item => item.id === id);
  return profile ? cloneContextProfile(profile) : undefined;
}

export function defaultContextProfile(): ContextProfile {
  return builtinContextProfile(DEFAULT_CONTEXT_PROFILE_ID)!;
}

export function builtinContextProfiles(): ContextProfile[] {
  return BUILTIN_PROFILES.map(cloneContextProfile);
}

/** 解析当前生效配置：自定义优先，其次内置，最后回退默认。 */
export function resolveContextProfile(activeId: string, custom: readonly ContextProfile[] = []): ContextProfile {
  return cloneContextProfile(custom.find(profile => profile.id === activeId)
    ?? builtinContextProfile(activeId)
    ?? defaultContextProfile());
}

export interface ContextProfileIssue {
  path: string;
  message: string;
}

export function conditionDepth(condition: ContextCondition): number {
  return condition.kind === 'compare' ? 1 : 1 + Math.max(0, ...condition.conditions.map(conditionDepth));
}

function compareCount(condition: ContextCondition): number {
  return condition.kind === 'compare' ? 1 : condition.conditions.reduce((total, item) => total + compareCount(item), 0);
}

/** 页面仅投影同一 Schema 的错误，不另建一套只在浏览器生效的校验规则。 */
export function validateContextProfile(profile: unknown): ContextProfileIssue[] {
  const parsed = ContextProfileSchema.safeParse(profile);
  return parsed.success
    ? []
    : parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }));
}
