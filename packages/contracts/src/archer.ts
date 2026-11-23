/**
 * Archer Harness — 容器、Provider 依赖与 Agent 公开 API
 *
 * 这些类型同时服务进程内 SDK 与跨进程适配层；
 * 只有可 JSON 序列化的数据允许出现在命令与查询边界。
 */

import { z } from 'zod';
import type { AgentDraft, AgentEvent, AgentInput, AgentListInput, AgentSnapshot, AgentSummary, FollowUpOptions,
  TurnEvent, TurnRef, TurnSnapshot } from './agent-session.js';
import type { AbortOptions, CreateAgentOptions, EventReadInput, PromptOptions, ReadOptions, RenameAgentInput,
  ConfigureExecutionInput, SteerOptions, SubmitOptions, TurnListInput, WaitOptions, WatchOptions } from './agent-session.js';
import { ArcherError } from './archer-error.js';
import type { EffectType } from './effect.js';
import type { Snapshot } from './json.js';
import type { InferenceProgress } from './progress.js';
import type { ArcherContext, ArcherContextBuilder } from './archer-context.js';
import type { Camp, CapabilityRef } from './provider.js';

// ─────────────────────────────────────────────
// 依赖
// ─────────────────────────────────────────────

export interface OpenContext {
  readonly signal: AbortSignal;
}

export interface Opened<T> {
  readonly value: T;
  close(): Promise<void>;
}

/** 直接提供实例表示借用；提供 open 表示容器拥有返回的 Opened */
export type Dependency<T> = T | {
  open(context: OpenContext): Promise<Opened<T>>;
};

// ─────────────────────────────────────────────
// 容器
// ─────────────────────────────────────────────

export type ArcherState =
  | 'created'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed';

export interface StopOptions {
  /** 不提供表示不设停止预算 */
  timeoutMs?: number;
}

export interface ArcherOptions {
  camp: Dependency<Camp>;
  inference?: CapabilityRef;
  journal?: CapabilityRef;
  preparations?: readonly CapabilityRef[];
  clock?: () => number;
  configureContext?: (builder: ArcherContextBuilder) => void;
  onError?: (error: ArcherError) => void;
  onEffectExecuted?: (record: EffectExecutionRecord) => void;
}

/** 一次 Effect 执行的观测记录；abandoned 表示停止流程放弃执行、结果保持未知 */
export interface EffectExecutionRecord {
  readonly agentId: string;
  readonly turnId: string;
  readonly effectId: string;
  readonly type: EffectType;
  readonly status: 'completed' | 'failed' | 'cancelled' | 'unknown' | 'abandoned';
  readonly durationMs: number;
}

export interface Archer {
  readonly state: ArcherState;
  /** 应用运行后可供宿主装配使用；Provider 不自动取得此容器。 */
  readonly context: ArcherContext;
  readonly camp: Camp;
  readonly agents: AgentManager;
  start(): Promise<void>;
  stop(options?: StopOptions): Promise<void>;
}

// ─────────────────────────────────────────────
// Agent 管理
// ─────────────────────────────────────────────

export interface AgentManager {
  create(options: CreateAgentOptions): Promise<Agent>;
  get(agentId: string, options?: ReadOptions): Promise<Agent | null>;
  list(
    input?: AgentListInput,
    options?: ReadOptions,
  ): Promise<readonly Snapshot<AgentSummary>[]>;
  remove(agentId: string): Promise<void>;
  rename(agentId: string, input: RenameAgentInput): Promise<void>;
  configureExecution(agentId: string, input: ConfigureExecutionInput): Promise<void>;
  resumeQueue(agentId: string): Promise<void>;
  clearQueue(agentId: string): Promise<void>;
  issueHumanToken(agentId: string, input: HumanTarget): Promise<HumanToken>;
  reply(agentId: string, input: HumanReply): Promise<void>;
  reconcile(agentId: string, input: ReconcileInput): Promise<void>;
  watchProgress(agentId: string, options?: ReadOptions): AsyncIterable<Snapshot<InferenceProgress>>;
  watch(agentId: string, options: WatchOptions): AsyncIterable<Snapshot<AgentEvent>>;
}

export interface TurnQueries {
  get(
    turnId: string,
    options?: ReadOptions,
  ): Promise<Snapshot<TurnSnapshot> | null>;
  findByRequestId(
    requestId: string,
    options?: ReadOptions,
  ): Promise<Snapshot<TurnSnapshot> | null>;
  list(
    input?: TurnListInput,
    options?: ReadOptions,
  ): Promise<readonly Snapshot<TurnSnapshot>[]>;
  events(
    turnId: string,
    input?: EventReadInput,
    options?: ReadOptions,
  ): Promise<readonly Snapshot<TurnEvent>[]>;
  watch(turnId: string, options: WatchOptions): AsyncIterable<Snapshot<TurnEvent>>;
}

export interface Agent {
  readonly id: string;
  readonly turns: TurnQueries;

  prompt(input: AgentInput, options?: PromptOptions): Promise<void>;
  send(input: AgentInput, options?: SubmitOptions): Promise<TurnRef>;
  steer(input: AgentInput, options?: SteerOptions): Promise<void>;
  followUp(input: AgentInput, options?: FollowUpOptions): Promise<void>;
  abort(options?: AbortOptions): Promise<void>;
  wait(turnId: string, options?: WaitOptions): Promise<void>;
  getState(options?: ReadOptions): Promise<Snapshot<AgentSnapshot>>;
  events(
    input?: EventReadInput,
    options?: ReadOptions,
  ): Promise<readonly Snapshot<AgentEvent>[]>;
  subscribe(listener: (event: AgentEvent) => void): () => void;
}

// ─────────────────────────────────────────────
// 事实存储边界
// ─────────────────────────────────────────────

export interface AgentAppendInput {
  agentId: string;
  expectedSeq: number;
  drafts: readonly AgentDraft[];
}

export interface AgentJournal {
  ids(): Promise<readonly string[]>;
  read(agentId: string, afterSeq?: number): Promise<readonly AgentEvent[]>;
  append(input: AgentAppendInput): Promise<readonly AgentEvent[]>;
}

// ─────────────────────────────────────────────
// 人工通道与对账
// ─────────────────────────────────────────────

export interface HumanTarget {
  turnId: string;
  effectId: string;
}

export interface HumanToken extends HumanTarget {
  token: string;
  expiresAt: number;
}

export interface HumanReply extends HumanTarget {
  token: string;
  approved: boolean;
  response: string;
}

export interface ReconcileInput extends HumanTarget {
  decision: { kind: 'retry' } | { kind: 'abandon'; reason: string };
}

// ─────────────────────────────────────────────
// 重新导出常用协议
// ─────────────────────────────────────────────

export type {
  AgentEvent,
  AgentListInput,
  AgentSnapshot,
  AgentSummary,
  CreateAgentOptions,
  TurnRef,
  TurnSnapshot,
};

/** 人工命令由入口鉴权保护，凭证只绑定指定的等待项。 */
export const HumanTargetSchema = z.object({ turnId: z.string().min(1), effectId: z.string().min(1) }).strict();
export const HumanReplySchema = HumanTargetSchema.extend({ token: z.string().min(1), approved: z.boolean(), response: z.string() }).strict();
export const ReconcileInputSchema = HumanTargetSchema.extend({ decision: z.discriminatedUnion('kind', [z.object({ kind: z.literal('retry') }).strict(), z.object({ kind: z.literal('abandon'), reason: z.string().min(1) }).strict()]) }).strict();
