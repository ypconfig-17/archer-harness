/**
 * Archer Harness — Effect 执行管线
 *
 * 决策层只提交 dispatch_effect 命令；Runtime 用 handler 解释具体 Effect。
 * 固定包装器负责提交、人工等待与授权；末端 handler 只解释能力。
 */

import type { Effect, Inference, InferenceChunk, KernelError, FileAccess, CapabilityRef, ToolMetadata,
  OperationContext, JsonValue, Workspace, Preparation, InferEffect, InferResult } from '@archer/contracts';
import type { SessionEffectOutcome, SessionInferenceRequest, SessionCompaction } from '@archer/agent';

export type { EffectExecutionRecord } from '@archer/contracts';

/** 当前允许通过管线执行的 Effect 类型；其余类型由 Runtime 直接拒绝或走等待 */
export type DispatchedEffectType = 'INFER' | 'CALL';

/** 判断 Effect 是否通过 handler 管线执行 */
export function isDispatchedEffect(
  effect: Effect,
): effect is Extract<Effect, { type: DispatchedEffectType }> {
  return effect.type === 'CALL' || effect.type === 'INFER';
}

/** 本次 CALL 的固定 Provider 实现，函数仅存在于进程内。 */
export interface EffectTarget {
  readonly ref: CapabilityRef;
  readonly metadata: ToolMetadata;
  readonly invoke: (input: JsonValue, context: OperationContext) => JsonValue | Promise<JsonValue>;
}

/** 宿主的唯一日志提交端口；包装器不能绕过 Agent 串行边界写入存储 */
export interface ExecutionJournal {
  begin(): Promise<boolean>;
  complete(outcome: SessionEffectOutcome): Promise<void>;
  suspend(): Promise<void>;
}

/** 提交确认失败不能降级为 Provider 失败，否则会继续使用不确定事实。 */
export class ExecutionCommitError extends Error {
  constructor(cause: unknown) {
    super('Execution fact commit failed.', { cause });
  }
}

/** Handler 执行所需的进程内上下文，不进入事件载荷。 */
export interface HandlerContext {
  readonly history?: import('@archer/contracts').HistoryReader;
  readonly executionFacts?: readonly import('./execution-reference.js').ExecutionFact[];
  readonly tokenBudget?: number;
  readonly inferenceHistory: readonly SessionInferenceRequest[];
  readonly effectRequests: readonly SessionInferenceRequest[];
  readonly compactions: readonly SessionCompaction[];
  readonly executeInference: (request: InferEffect, purpose: 'agent' | 'compaction', run: () => Promise<InferResult>) => Promise<SessionInferenceRequest>;
  readonly commitCompaction: (requestId: string, coveredMessageCount: number) => Promise<SessionCompaction>;
  readonly agentId: string;
  readonly turnId: string;
  readonly effectId: string;
  readonly signal: AbortSignal;
  readonly now: () => number;
  readonly inference: Inference;
  /** 只观察临时文本，不参与决策或持久化提交。 */
  readonly onInferenceProgress?: (chunk: InferenceChunk) => void;
  readonly allowShell?: boolean;
  readonly journal?: ExecutionJournal;
  readonly files?: FileAccess;
  readonly workspace?: Workspace;
  readonly prepare: (request: Preparation) => Promise<JsonValue>;
  readonly target: EffectTarget | null;
  readonly targetError: KernelError | null;
  /**
   * Runtime 正在停止。停止期间的中止无法区分“未执行”与“已执行但结果未知”，
   * handler 返回 null 保留 started，交给恢复流程判定。
   */
  readonly isStopping: () => boolean;
}

/**
 * 一次 Effect 执行的结果。
 *
 * null 表示人工等待或停止流程未产生收束结果，Runtime 不得提交完成事实。
 */
export type EffectHandler = (
  effect: Effect,
  context: HandlerContext,
) => Promise<SessionEffectOutcome | null>;

/** Handler 包装；可靠执行包装由宿主固定组装，观测包装不得改写事实 */
export type EffectMiddleware = (next: EffectHandler) => EffectHandler;

/** 按 Effect 类型索引的 handler 表；新增可执行类型时必须补齐 */
export type HandlerTable = {
  [K in DispatchedEffectType]: (
    effect: Extract<Effect, { type: K }>,
    context: HandlerContext,
  ) => Promise<SessionEffectOutcome | null>;
};

/**
 * 从右到左组合中间件，最外层先执行。
 * @param handler - 管线末端的能力 handler。
 * @param middlewares - 按进入顺序声明的包装器；Runtime 的固定装配见 execution-pipeline.ts。
 * @returns 可直接调用的 handler。
 */
export function composeMiddleware(
  handler: EffectHandler,
  middlewares: readonly EffectMiddleware[],
): EffectHandler {
  return middlewares.reduceRight<EffectHandler>(
    (next, middleware) => middleware(next),
    handler,
  );
}

/**
 * 按 Effect 类型选择 handler 并套上中间件。
 * @param table - 覆盖全部可执行类型的 handler 表。
 * @param middlewares - 组合到表分发之外的中间件。
 * @returns 管线的统一入口。
 */
export function createDispatcher(
  table: HandlerTable,
  middlewares: readonly EffectMiddleware[] = [],
): EffectHandler {
  const dispatch: EffectHandler = (effect, context) => {
    // 人工请求已由外层包装器处理；其余未支持类型在这里明确拒绝。
    if (!isDispatchedEffect(effect)) return Promise.resolve({
      status: 'failed', error: { code: 'EFFECT_UNSUPPORTED', message: `Effect 类型没有执行实现：${effect.type}` }, durationMs: 0,
    });
    const handler = table[effect.type] as EffectHandler;
    return handler(effect, context);
  };
  return composeMiddleware(dispatch, middlewares);
}
