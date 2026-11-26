/** 上下文整理的固定编排：投影、选择、执行与收益核验；不另建提交或恢复端口。 */
import {
  OperationRejected,
  canonicalJson,
  type ContextMetrics,
  type ContextPlan,
  type ContextPlanStep,
  type ContextProfile,
  type ContextStep,
  type InferEffect,
  type Message,
} from '@archer/contracts';
import type { SessionCompaction, SessionInferenceRequest } from '@archer/agent';
import { buildContext } from './context.js';
import { measureWindow } from './context-window.js';
import { planCompaction, validateCompaction } from './compaction.js';
import {
  measureUncoveredHistory,
  needsUncoveredTokens,
  recentTargetTokens,
  selectContextStep,
  type ContextStepReason,
} from './context-policy.js';
import { executionReference } from './execution-reference.js';
import type { HandlerContext } from './pipeline.js';
import { boundToolResults } from './tool-result-window.js';

const MAX_COMPACTIONS = 4;
const MAX_PASSES = 16;
const RECOVERABLE_COMPACTION_ERRORS = new Set([
  'CONTEXT_COMPACTION_INVALID',
  'CONTEXT_COMPACTION_NO_GAIN',
  'CONTEXT_COMPACTION_UNAVAILABLE',
]);

/** 日志省略 undefined 并规范化键顺序；恢复匹配不依赖对象构造顺序。 */
function requestIdentity(request: InferEffect): string {
  return canonicalJson(JSON.parse(JSON.stringify(request)));
}

/** 组装包含已采纳摘要与运行事实参考的完整推理请求。 */
function buildPreparedEffect(
  effect: InferEffect,
  context: HandlerContext,
  references: readonly Message[],
  selectedSummary: SessionCompaction | undefined,
): InferEffect {
  const built = buildContext(effect, selectedSummary);
  const facts = selectedSummary ? executionReference(context.executionFacts ?? []) : undefined;
  const currentReferences = facts ? [...references, facts] : references;
  return {
    ...built,
    messages: [
      ...built.messages.slice(0, built.promptPrefixCount),
      ...currentReferences,
      ...built.messages.slice(built.promptPrefixCount),
    ],
    promptPrefixCount: built.promptPrefixCount + currentReferences.length,
  };
}

/** 判断自最近一次已采纳摘要之后是否已出现未采纳的历史摘要请求，用于软封顶防重复空耗。 */
function hasFailedCompactionSinceAdopted(
  inferenceHistory: readonly SessionInferenceRequest[],
  summary: SessionCompaction | undefined,
): boolean {
  let lastAdoptedIndex = -1;
  if (summary) {
    for (let index = inferenceHistory.length - 1; index >= 0; index--) {
      if (inferenceHistory[index]!.requestId === summary.requestId) {
        lastAdoptedIndex = index;
        break;
      }
    }
  }
  return inferenceHistory
    .slice(lastAdoptedIndex + 1)
    .some(request => request.purpose === 'compaction' && request.status === 'completed');
}

/** 执行无损工具结果节选并验证净收益。 */
function applyTrimStep(
  prepared: InferEffect,
  context: HandlerContext,
  profile: ContextProfile,
  step: Extract<ContextStep, { kind: 'trim-tool-results' }>,
  reason: ContextStepReason,
  beforeTokens: number,
): { prepared: InferEffect; recorded: ContextPlanStep } | null {
  const trimmed = boundToolResults(prepared, context, step.params.minSavingsRatio, profile.targetWindowTokens);
  const after = measureWindow(trimmed, context.inference);
  if (!after || after.estimatedInputTokens >= beforeTokens) return null;
  return {
    prepared: trimmed,
    recorded: {
      stepId: step.id,
      kind: step.kind,
      reason,
      beforeTokens,
      afterTokens: after.estimatedInputTokens,
    },
  };
}

/** 规划、复用或执行一次摘要请求，并完成结构校验、收益核验与事实提交。 */
async function applyCompactStep(params: {
  effect: InferEffect;
  prepared: InferEffect;
  context: HandlerContext;
  references: readonly Message[];
  profile: ContextProfile;
  step: Extract<ContextStep, { kind: 'compact' }>;
  reason: ContextStepReason;
  metrics: ContextMetrics;
  beforeTokens: number;
  windowMethod: string;
  windowInputLimit: number;
  windowOutputReserve: number;
  windowSafetyMargin: number;
  summary: SessionCompaction | undefined;
  compactionRequests: SessionInferenceRequest[];
  callCompaction: (request: InferEffect) => Promise<SessionInferenceRequest>;
}): Promise<
  | { status: 'adopted'; prepared: InferEffect; summary: SessionCompaction; recorded: ContextPlanStep }
  | { status: 'blocked'; error?: OperationRejected }
> {
  const {
    effect,
    prepared,
    context,
    references,
    profile,
    step,
    reason,
    metrics,
    beforeTokens,
    windowMethod,
    windowInputLimit,
    windowOutputReserve,
    windowSafetyMargin,
    summary,
    compactionRequests,
    callCompaction,
  } = params;

  const plan = planCompaction(
    effect,
    context,
    recentTargetTokens(step, metrics, profile),
    summary,
    prepared,
    step.params,
  );
  if (!plan) return { status: 'blocked' };

  // 响应已确认但尚未采用时复用原响应；无效响应也不重复花费。
  const reusable = compactionRequests.find(
    request => request.status === 'completed' && requestIdentity(request.request) === requestIdentity(plan.request),
  );
  // 已确认响应的采用不再调用模型，额度耗尽时仍允许恢复；仅拒绝新增摘要请求。
  if (!reusable && compactionRequests.length >= MAX_COMPACTIONS) {
    return { status: 'blocked' };
  }

  const record = reusable ?? await callCompaction(plan.request);
  if (!reusable) compactionRequests.push(record);

  let candidate: InferEffect;
  let afterTokens: number;
  try {
    validateCompaction(
      record.result!,
      effect.messages.slice(effect.promptPrefixCount, effect.promptPrefixCount + plan.coveredMessageCount),
    );
    candidate = buildPreparedEffect(effect, context, references, {
      effectId: context.effectId,
      requestId: record.requestId,
      coveredMessageCount: plan.coveredMessageCount,
      summary: record.result!.content,
    });
    const after = measureWindow(candidate, context.inference);
    if (
      !after
      || after.method !== windowMethod
      || after.inputLimit !== windowInputLimit
      || after.outputReserve !== windowOutputReserve
      || after.safetyMargin !== windowSafetyMargin
    ) {
      throw new OperationRejected('摘要前后的窗口计量口径发生变化，不能核实压缩收益，未采用摘要。', 'CONTEXT_MEASUREMENT_CHANGED');
    }
    if (after.estimatedInputTokens >= beforeTokens) {
      throw new OperationRejected('摘要没有减少完整模型输入，未采用该摘要。', 'CONTEXT_COMPACTION_NO_GAIN');
    }
    afterTokens = after.estimatedInputTokens;
  } catch (error) {
    if (!(error instanceof OperationRejected) || !RECOVERABLE_COMPACTION_ERRORS.has(error.code)) throw error;
    return { status: 'blocked', error };
  }

  const committed = await context.commitCompaction(record.requestId, plan.coveredMessageCount);
  return {
    status: 'adopted',
    prepared: candidate,
    summary: committed,
    recorded: {
      stepId: step.id,
      kind: step.kind,
      reason,
      beforeTokens,
      afterTokens,
    },
  };
}

/**
 * 无法执行或没有收益的步骤仅对当前输入阻塞，后续步骤仍有补救机会。
 * 真实请求始终经由主推理管线记账；提交异常与计量口径变化不得作为可恢复失败吞掉。
 */
export async function manageContext(
  effect: InferEffect,
  context: HandlerContext,
  references: readonly Message[],
  callCompaction: (request: InferEffect) => Promise<SessionInferenceRequest>,
): Promise<{ request: InferEffect; plan?: ContextPlan }> {
  const profile = effect.config?.contextProfile;
  if (!profile) {
    throw new OperationRejected('已提交的 INFER 缺少上下文策略快照。', 'CONTEXT_PROFILE_REQUIRED');
  }

  let summary = context.compactions.at(-1);
  let prepared = buildPreparedEffect(effect, context, references, summary);
  const initialWindow = measureWindow(prepared, context.inference);
  if (!initialWindow) return { request: prepared };

  const applied: ContextPlanStep[] = [];
  const blocked = new Set<string>();
  const measureGrowth = needsUncoveredTokens(profile);
  // 上限来自已提交请求而非进程内计数，崩溃重启不能重新获得四次摘要额度。
  const compactionRequests = context.effectRequests.filter(request => request.purpose === 'compaction');
  const failedSinceAdopted = hasFailedCompactionSinceAdopted(context.inferenceHistory, summary);
  let lastCompactionError: OperationRejected | undefined;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const window = measureWindow(prepared, context.inference);
    if (!window) break;
    const uncovered = measureGrowth
      ? measureUncoveredHistory(effect, context.inference, summary?.coveredMessageCount ?? 0)
      : undefined;
    const metrics: ContextMetrics = {
      estimatedInputTokens: window.estimatedInputTokens,
      inputLimit: window.inputLimit,
      historyMessages: effect.messages.length - effect.promptPrefixCount,
      ...(uncovered === undefined ? {} : { uncoveredTokens: uncovered }),
    };

    const selection = selectContextStep(profile, metrics, blocked);
    if (!selection) break;
    const { step, reason } = selection;
    const beforeTokens = window.estimatedInputTokens;

    if (step.kind === 'trim-tool-results') {
      const outcome = applyTrimStep(prepared, context, profile, step, reason, beforeTokens);
      if (!outcome) {
        blocked.add(step.id);
        continue;
      }
      prepared = outcome.prepared;
      applied.push(outcome.recorded);
      blocked.clear();
      continue;
    }

    // 未逼近物理模型上限（85%）时，若自上次有效摘要后已有失败尝试，暂停在增长线或软封顶上重复空耗。
    const nearPhysicalLimit = metrics.estimatedInputTokens > Math.floor(metrics.inputLimit * 0.85);
    if (failedSinceAdopted && (reason === 'growth' || !nearPhysicalLimit)) {
      blocked.add(step.id);
      continue;
    }

    const outcome = await applyCompactStep({
      effect,
      prepared,
      context,
      references,
      profile,
      step,
      reason,
      metrics,
      beforeTokens,
      windowMethod: window.method,
      windowInputLimit: window.inputLimit,
      windowOutputReserve: window.outputReserve,
      windowSafetyMargin: window.safetyMargin,
      summary,
      compactionRequests,
      callCompaction,
    });
    if (outcome.status === 'blocked') {
      if (outcome.error) lastCompactionError = outcome.error;
      blocked.add(step.id);
      continue;
    }

    summary = outcome.summary;
    prepared = outcome.prepared;
    applied.push(outcome.recorded);
    blocked.clear();
  }

  const finalWindow = measureWindow(prepared, context.inference);
  if (lastCompactionError && finalWindow && finalWindow.estimatedInputTokens > finalWindow.inputLimit) {
    throw lastCompactionError;
  }

  return {
    request: prepared,
    ...(finalWindow ? {
      plan: {
        profileId: profile.id,
        profileName: profile.name,
        profileRevision: profile.revision,
        beforeTokens: initialWindow.estimatedInputTokens,
        afterTokens: finalWindow.estimatedInputTokens,
        inputLimit: finalWindow.inputLimit,
        steps: applied,
      },
    } : {}),
  };
}
