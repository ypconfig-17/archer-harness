/**
 * Archer Harness — Agent 会话与 Turn 事实协议
 *
 * 一个 Agent 对应一个会话；AgentEvent 是唯一可重放的会话事实。
 * 事件草稿只包含事实本身，id / seq / turnSeq / ts 由 AgentJournal 赋值。
 */

import { z } from 'zod';
import { ActionPlanSchema, TurnTerminalSchema } from './agent.js';
import { ErrorDataSchema, type ErrorData } from './archer-error.js';
import {
  EffectSchema,
  EffectTypeSchema,
  InferResultSchema,
  InferEffectSchema,
  CallResultSchema,
} from './effect.js';
import { JsonObjectSchema } from './json-schema.js';
import { type InferConfig, InferConfigSchema, MessageSchema, ImageBlockSchema, type Message } from './message.js';

// ─────────────────────────────────────────────
// 输入与视图
// ─────────────────────────────────────────────

/** 允许进入模型上下文的内容块 */
export const ContentBlockSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), text: z.string() }),
  ImageBlockSchema,
  // 文本附件直接保存内容，使提交与回放不依赖外部路径；二进制文件不进入此协议。
  z.strictObject({
    type: z.literal('file'),
    filename: z.string().min(1).max(255),
    mediaType: z.literal('text/plain'),
    text: z.string().max(256 * 1024),
  }),
]);
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

/** 字符串等价于单个文本块 */
export const AgentInputSchema = z.union([
  z.string(),
  z.strictObject({
    content: z.array(ContentBlockSchema).refine(
      blocks => blocks.filter(block => block.type !== 'text').length <= 4,
      '单次输入最多四个附件',
    ),
  }),
]);
export type AgentInput = z.infer<typeof AgentInputSchema>;

/** 轻量投影用于标题和显示；文件只显示名称，模型正文由独立投影保留。 */
export function agentInputText(input: AgentInput): string {
  if (typeof input === 'string') return input;
  return input.content.flatMap(block => block.type === 'text' ? [block.text] : block.type === 'file' ? [`[附件：${block.filename}]`] : []).join('\n');
}

/** 输入事实确定性地投影为模型消息，恢复时无需读取外部图片或文件。 */
export function agentInputMessage(input: AgentInput): Message {
  const images = typeof input === 'string' ? [] : input.content.filter(block => block.type === 'image');
  // 文件作为用户数据投影，JSON 编码保留边界；不把附件正文升级为系统指令。
  const content = typeof input === 'string' ? input : input.content.flatMap(block =>
    block.type === 'text' ? [block.text] : block.type === 'file'
      ? [`Attached text file (user-provided data):\n${JSON.stringify({ filename: block.filename, text: block.text })}`] : [],
  ).join('\n');
  return { role: 'user', content, ...(images.length ? { images } : {}) };
}

// ─────────────────────────────────────────────
// 命令选项
// ─────────────────────────────────────────────

export interface InputOptions {
  requestId?: string;
}

export interface FollowUpOptions extends InputOptions {
  inference?: InferConfig;
}

export const CommandModeSchema = z.enum(['ask', 'auto', 'full']);
export type CommandMode = z.infer<typeof CommandModeSchema>;

export interface SubmitOptions extends FollowUpOptions {
  commandMode?: CommandMode;
  allowShell?: boolean;
  limits?: TurnLimits;
}

/** prompt 的 signal 只约束本地等待，不进入持久化提交 */
export interface PromptOptions extends SubmitOptions {
  signal?: AbortSignal;
}

export interface SteerOptions extends InputOptions {
  turnId?: string;
}

export interface AbortOptions extends InputOptions {
  turnId?: string;
  reason?: string;
}

export const TurnLimitsSchema = z.object({
  maxInferenceSteps: z.number().int().positive().optional(),
  tokenBudget: z.number().int().positive().optional(),
});
export type TurnLimits = z.infer<typeof TurnLimitsSchema>;

export interface ReadOptions {
  signal?: AbortSignal;
}

export interface WaitOptions {
  signal?: AbortSignal;
}

export interface TurnRef {
  readonly agentId: string;
  readonly turnId: string;
}

export const QueuedInputSchema = z.object({
  inputId: z.string().min(1),
  requestId: z.string().min(1),
  input: AgentInputSchema,
});
export type QueuedInput = z.infer<typeof QueuedInputSchema>;

export const CREATE_AGENT_COMMANDS = ['prompt', 'send', 'followUp'] as const;
export type InputCommand = (typeof CREATE_AGENT_COMMANDS)[number];

/** 宿主工作环境；cwd 必须由调用方显式提供。 */
export const WorkspaceSchema = z.object({
  cwd: z.string().min(1),
  access: z.enum(['read', 'edit']),
}).strict();
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const CreateAgentOptionsSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, 'Agent id 只能包含字母、数字、下划线、点和连字符'),
  instructions: z.string().min(1),
  workspace: WorkspaceSchema.optional(),
  inference: InferConfigSchema.optional(),
});
export type CreateAgentOptions = z.infer<typeof CreateAgentOptionsSchema>;

/** prompt / send 的跨进程请求体；signal 只存在于进程内调用 */
export const SubmitAgentInputSchema = z
  .object({
    input: AgentInputSchema,
    requestId: z.string().min(1).optional(),
    commandMode: CommandModeSchema.optional(),
    allowShell: z.boolean().optional(),
    limits: TurnLimitsSchema.optional(),
    inference: InferConfigSchema.optional(),
  })
  .strict();
export type SubmitAgentInput = z.infer<typeof SubmitAgentInputSchema>;

/** steer 的跨进程请求体 */
export const SteerAgentInputSchema = z
  .object({
    input: AgentInputSchema,
    requestId: z.string().min(1).optional(),
    turnId: z.string().min(1).optional(),
  })
  .strict();
export type SteerAgentInput = z.infer<typeof SteerAgentInputSchema>;

/** followUp 的跨进程请求体 */
export const FollowUpAgentInputSchema = z
  .object({
    inference: InferConfigSchema.optional(),
    input: AgentInputSchema,
    requestId: z.string().min(1).optional(),
  })
  .strict();
export type FollowUpAgentInput = z.infer<typeof FollowUpAgentInputSchema>;

/** abort 的跨进程请求体 */
export const AbortAgentInputSchema = z
  .object({
    requestId: z.string().min(1).optional(),
    turnId: z.string().min(1).optional(),
    reason: z.string().optional(),
  })
  .strict();
export type AbortAgentInput = z.infer<typeof AbortAgentInputSchema>;

const AgentTitleSchema = z.string().trim().min(1).max(200);

/** 会话标题的跨进程请求体 */
export const RenameAgentInputSchema = z
  .object({
    title: AgentTitleSchema,
  })
  .strict();
export type RenameAgentInput = z.infer<typeof RenameAgentInputSchema>;

const CommandAuthorizationSchema = z.object({
  turnId: z.string().min(1),
  allowShell: z.boolean(),
  commandMode: CommandModeSchema,
  // 确认弹窗固定等待项；null 明确表示打开时没有等待项，不能默认为任意当前项。
  expectedPendingEffectId: z.string().min(1).nullable().optional(),
  approveCommand: z.object({ effectId: z.string().min(1), token: z.string().min(1) }).strict().optional(),
}).strict().refine(value => !value.approveCommand || value.allowShell && value.commandMode === 'full'
  && value.expectedPendingEffectId === value.approveCommand.effectId, '合并批准只允许完全访问且必须固定当前等待命令');

/** 执行配置的跨进程请求体 */
export const ConfigureExecutionSchema = z
  .object({
    commandAuthorization: CommandAuthorizationSchema.optional(),
    expectedRevision: z.number().int().nonnegative(),
    workspaceAccess: z.enum(['read', 'edit']).optional(),
  })
  .strict();
export type ConfigureExecutionInput = z.infer<typeof ConfigureExecutionSchema>;

// ─────────────────────────────────────────────
// 快照
// ─────────────────────────────────────────────

export interface AgentSummary {
  id: string;
  /** 来自创建事实；活动时间相同时作为稳定排序键，不改变列表的 id 分页契约。 */
  createdAt: number;
  /** 最后一条已提交事实的时间；回放可重建，用于导航排序与相对时间展示。 */
  updatedAt: number;
  /** 用户确认的会话标题；未重命名时不提供，由界面回退到首条输入。 */
  title?: string;
  seq: number;
  activeTurnId: string | null;
  queuePaused: boolean;
}

export type AgentExecution = 'ready' | 'blocked' | 'isolated';

export type PendingInput =
  | { kind: 'human'; effectId: string; purpose?: 'command'; reason: string; options?: readonly string[] }
  | { kind: 'reconcile'; effectId: string; target: import('./provider.js').CapabilityRef; error?: ErrorData };

export type TurnStatus =
  | 'running'
  | 'waiting'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

export const TURN_TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const;

export function isTerminalTurnStatus(status: TurnStatus): boolean {
  return (TURN_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export interface TurnSnapshot extends TurnRef {
  /** Turn 创建事件的 Agent 日志序号，用于定位历史窗口 */
  agentSeq: number;
  createdAt: number;
  allowShell: boolean;
  commandMode: CommandMode;
  seq: number;
  status: TurnStatus;
  pending: PendingInput | null;
  error?: ErrorData;
}

export interface AgentSnapshot extends AgentSummary {
  workspace?: Workspace;
  instructions: string;
  inference: z.infer<typeof InferConfigSchema>;
  executionRevision: number;
  messages: readonly z.infer<typeof MessageSchema>[];
  queuedInputs: readonly QueuedInput[];
  pendingSteering: readonly (QueuedInput & { turnId: string })[];
  activeTurn: TurnSnapshot | null;
  execution: AgentExecution;
  fault?: ErrorData;
}

export interface AgentListInput {
  afterId?: string;
  limit?: number;
}



export interface WatchOptions {
  afterSeq: number;
  signal?: AbortSignal;
}

export interface TurnListInput {
  beforeAgentSeq?: number;
  limit?: number;
}

export interface EventReadInput {
  /** 增量窗口：返回严格大于该序号的事实 */
  afterSeq?: number;
  /** 历史窗口：返回严格小于该序号的事实；与 afterSeq 互斥 */
  beforeSeq?: number;
  limit?: number;
}

// ─────────────────────────────────────────────
// Agent 生命周期事实
// ─────────────────────────────────────────────

const InputAcceptedDataSchema = z.object({
  inputId: z.string().min(1),
  requestId: z.string().min(1),
  command: z.enum(CREATE_AGENT_COMMANDS),
  input: AgentInputSchema,
  commandMode: CommandModeSchema.optional(),
  allowShell: z.boolean(),
  limits: TurnLimitsSchema.optional(),
  inference: InferConfigSchema.optional(),
  receivedAt: z.number().int(),
});

const SteeringAcceptedDataSchema = z.object({
  inputId: z.string().min(1),
  requestId: z.string().min(1),
  input: AgentInputSchema,
  turnId: z.string().min(1),
  receivedAt: z.number().int(),
});

export const AgentLifecycleFactSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('agent.created'),
    data: z.object({
      id: z.string().min(1),
      instructions: z.string().min(1),
      workspace: WorkspaceSchema.optional(),
      inference: InferConfigSchema,
      capabilityFormat: z.literal('provider'),
      createKey: z.string().min(1),
      policyId: z.string().min(1),
      createdAt: z.number().int(),
    }),
  }),
  z.object({
    type: z.literal('input.accepted'),
    data: InputAcceptedDataSchema,
  }),
  z.object({
    type: z.literal('input.consumed'),
    data: z.object({ inputId: z.string().min(1), turnId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal('input.unapplied'),
    data: z.object({ inputId: z.string().min(1), reason: z.string() }),
  }),
  z.object({
    type: z.literal('steering.accepted'),
    data: SteeringAcceptedDataSchema,
  }),
  z.object({
    type: z.literal('steering.consumed'),
    data: z.object({ inputId: z.string().min(1), turnId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal('steering.unapplied'),
    data: z.object({
      inputId: z.string().min(1),
      turnId: z.string().min(1),
      reason: z.string(),
    }),
  }),
  z.object({
    type: z.literal('command.accepted'),
    data: z.object({
      requestId: z.string().min(1),
      command: z.enum(['abort', 'resumeQueue', 'clearQueue']),
      signature: z.string().min(1),
    }),
  }),
  z.object({
    type: z.literal('queue.paused'),
    data: z.object({ reason: z.string() }),
  }),
  z.object({ type: z.literal('queue.resumed'), data: z.object({}) }),
  z.object({
    type: z.literal('queue.cleared'),
    data: z.object({ inputIds: z.array(z.string().min(1)) }),
  }),
  z.object({
    type: z.literal('execution.configured'),
    data: z.object({
      workspaceAccess: z.enum(['read', 'edit']).optional(),
      expectedRevision: z.number().int().nonnegative(),
      revision: z.number().int().nonnegative(),
    }),
  }),
  z.object({
    type: z.literal('agent.renamed'),
    data: z.object({ title: AgentTitleSchema, renamedAt: z.number().int() }),
  }),
  z.object({
    type: z.literal('agent.removed'),
    data: z.object({ removedAt: z.number().int() }),
  }),
]);
export type AgentLifecycleFact = z.infer<typeof AgentLifecycleFactSchema>;

// ─────────────────────────────────────────────
// Turn 事实
// ─────────────────────────────────────────────

const EffectCompletedDataSchema = z.discriminatedUnion('effectType', [
  z.object({ effectId: z.string(), effectType: z.literal('CALL'), result: CallResultSchema, durationMs: z.number().int().nonnegative(), finishedAt: z.number().int() }),
  z.object({
    effectId: z.string(),
    effectType: z.literal('INFER'),
    result: InferResultSchema,
    durationMs: z.number().int().nonnegative(),
    finishedAt: z.number().int(),
  }),
]);

export const TURN_FACT_TYPES = [
  'turn.created',
  'turn.status',
  'turn.authorization.changed',
  'turn.cancel.requested',
  'message.appended',
  'inference.started',
  'inference.planned',
  'inference.requested',
  'inference.responded',
  'inference.request.failed',
  'context.compacted',
  'completion.review.requested',
  'effect.created',
  'effect.started',
  'effect.suspended',
  'effect.resumed',
  'effect.completed',
  'effect.failed',
  'effect.cancelled',
  'effect.unknown',
  'effect.abandoned',
  'turn.completed',
  'turn.failed',
  'turn.cancelled',
] as const;

export const TurnFactSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('turn.cancel.requested'),
    data: z.object({ reason: z.string(), requestedAt: z.number().int() }),
  }),
  z.object({
    type: z.literal('turn.created'),
    data: z.object({
      turnId: z.string().min(1),
      inputId: z.string().min(1),
      commandMode: CommandModeSchema.optional(),
      allowShell: z.boolean(),
      limits: TurnLimitsSchema.optional(),
      inference: InferConfigSchema.optional(),
      createdAt: z.number().int(),
    }),
  }),
  z.object({
    type: z.literal('turn.authorization.changed'),
    data: z.object({ allowShell: z.boolean(), commandMode: CommandModeSchema }),
  }),
  z.object({
    type: z.literal('turn.status'),
    data: z.object({
      status: z.enum(['running', 'waiting', 'cancelling']),
      reason: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('message.appended'),
    data: z.object({ message: MessageSchema }),
  }),
  z.object({
    type: z.literal('completion.review.requested'),
    data: z.object({ afterEffectId: z.string().min(1), requestedAt: z.number().int() }).strict(),
  }),
  z.object({
    type: z.literal('inference.started'),
    data: z.object({ step: z.number().int().positive(), startedAt: z.number().int() }),
  }),
  z.object({
    type: z.literal('inference.planned'),
    data: z.object({
      step: z.number().int().positive(),
      actions: z.array(ActionPlanSchema),
      terminal: TurnTerminalSchema.optional(),
    }),
  }),
  z.object({
    type: z.literal('inference.requested'),
    data: z.object({
      effectId: z.string().min(1), requestId: z.string().min(1),
      purpose: z.enum(['agent', 'compaction']), request: InferEffectSchema,
      requestedAt: z.number().int(),
    }).strict(),
  }),
  z.object({
    type: z.literal('inference.responded'),
    data: z.object({ effectId: z.string().min(1), requestId: z.string().min(1), result: InferResultSchema, respondedAt: z.number().int() }).strict(),
  }),
  z.object({
    type: z.literal('inference.request.failed'),
    data: z.object({ effectId: z.string().min(1), requestId: z.string().min(1), error: ErrorDataSchema, failedAt: z.number().int() }).strict(),
  }),
  z.object({
    type: z.literal('context.compacted'),
    data: z.object({ effectId: z.string().min(1), requestId: z.string().min(1), coveredMessageCount: z.number().int().positive(), summary: z.string().min(1), compactedAt: z.number().int() }).strict(),
  }),
  z.object({
    type: z.literal('effect.created'),
    data: z.object({
      effectId: z.string().min(1),
      effect: EffectSchema,
      idempotencyKey: z.string().min(1),
      createdAt: z.number().int(),
    }),
  }),
  z.object({
    type: z.literal('effect.started'),
    data: z.object({
      effectId: z.string().min(1),
      effectType: EffectTypeSchema,
      attempt: z.number().int().positive(),
      startedAt: z.number().int(),
    }),
  }),
  z.object({
    type: z.literal('effect.suspended'),
    data: z.object({
      effectId: z.string().min(1),
      reason: z.string(),
      resumeTokenHash: z.string().min(1),
      expiresAt: z.number().int().optional(),
      suspendedAt: z.number().int(),
    }),
  }),
  z.object({
    type: z.literal('effect.resumed'),
    data: z.object({
      effectId: z.string().min(1),
      attempt: z.number().int().nonnegative(),
      kind: z.enum(['human', 'reconcile_retry']),
      resumedAt: z.number().int(),
    }),
  }),
  z.object({
    type: z.literal('effect.completed'),
    data: EffectCompletedDataSchema,
  }),
  z.object({
    type: z.literal('effect.failed'),
    data: z.object({
      effectId: z.string().min(1),
      effectType: EffectTypeSchema,
      error: ErrorDataSchema,
      durationMs: z.number().int().nonnegative().optional(),
      finishedAt: z.number().int(),
    }),
  }),
  z.object({
    type: z.literal('effect.cancelled'),
    data: z.object({
      effectId: z.string().min(1),
      reason: z.string(),
      finishedAt: z.number().int(),
    }),
  }),
  z.object({
    type: z.literal('effect.abandoned'),
    data: z.object({ effectId: z.string().min(1), reason: z.string().min(1), abandonedAt: z.number().int() }),
  }),
  z.object({
    type: z.literal('effect.unknown'),
    data: z.object({
      effectId: z.string().min(1),
      lastKnownStatus: z.literal('started'),
      detectedAt: z.number().int(),
      error: ErrorDataSchema.optional(),
    }),
  }),
  z.object({
    type: z.literal('turn.completed'),
    data: z.object({
      summary: z.string().optional(),
      stopReason: z.enum(['done', 'respond']),
      completedAt: z.number().int(),
    }),
  }),
  z.object({
    type: z.literal('turn.failed'),
    data: z.object({ error: ErrorDataSchema, completedAt: z.number().int() }),
  }),
  z.object({
    type: z.literal('turn.cancelled'),
    data: z.object({ reason: z.string().optional(), completedAt: z.number().int() }),
  }),
]);
export type TurnFact = z.infer<typeof TurnFactSchema>;
export type TurnFactType = TurnFact['type'];

// ─────────────────────────────────────────────
// 事件信封
// ─────────────────────────────────────────────

export const AgentFactSchema = z.union([
  z.object({
    scope: z.literal('agent'),
    event: AgentLifecycleFactSchema,
  }),
  z.object({
    scope: z.literal('turn'),
    turnId: z.string().min(1),
    event: TurnFactSchema,
  }),
]);
export type AgentFact = z.infer<typeof AgentFactSchema>;

/** 内核产出的事实草稿；信封字段由 AgentJournal 赋值 */
export type AgentDraft = AgentFact;

export const AgentEventSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  seq: z.number().int().positive(),
  ts: z.number().int(),
  fact: z.discriminatedUnion('scope', [
    z.object({
      scope: z.literal('agent'),
      event: AgentLifecycleFactSchema,
    }),
    z.object({
      scope: z.literal('turn'),
      turnId: z.string().min(1),
      turnSeq: z.number().int().positive(),
      event: TurnFactSchema,
    }),
  ]),
});
export type AgentEvent = z.infer<typeof AgentEventSchema>;

const TurnEventEnvelopeSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  turnId: z.string().min(1),
  agentSeq: z.number().int().positive(),
  seq: z.number().int().positive(),
  ts: z.number().int(),
});

/** Turn 事件是 Agent 日志中 scope=turn 子序列的协议投影，不再单独落盘 */
export const TurnEventSchema = z.intersection(TurnEventEnvelopeSchema, TurnFactSchema);
export type TurnEvent = z.infer<typeof TurnEventSchema>;

/** 供解析模型计划时复用的负载类型 */
export type AgentLifecyclePayload<K extends AgentLifecycleFact['type']> = Extract<
  AgentLifecycleFact,
  { type: K }
>['data'];

export type TurnPayload<K extends TurnFact['type']> = Extract<TurnFact, { type: K }>['data'];

function assertJsonObject(value: unknown): void {
  JsonObjectSchema.parse(value);
}

export { assertJsonObject };
