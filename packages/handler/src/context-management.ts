/** 上下文整理的固定编排：投影、选择、执行与收益核验；不另建提交或恢复端口。 */
import {
  OperationRejected,
  canonicalJson,
  type ContextMetrics,
  type ContextPlan,
  type ContextPlanStep,
  type InferEffect,
  type Message,
} from '@archer/contracts';
import type { SessionCompaction, SessionInferenceRequest } from '@archer/agent';
import { buildContext } from './context.js';
import { measureWindow } from './context-window.js';
import { planCompaction, validateCompaction } from './compaction.js';
import { measureUncoveredHistory, needsUncoveredTokens, recentTargetTokens, selectContextStep } from './context-policy.js';
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
  const build = (selectedSummary: SessionCompaction | undefined): InferEffect => {
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
  };
  let prepared = build(summary);
  const initialWindow = measureWindow(prepared, context.inference);
  if (!initialWindow) return { request: prepared };
  const applied: ContextPlanStep[] = [];
  const blocked = new Set<string>();
  const measureGrowth = needsUncoveredTokens(profile);
  // 上限来自已提交请求而非进程内计数，崩溃重启不能重新获得四次摘要额度。
  const compactionRequests = context.effectRequests.filter(request => request.purpose === 'compaction');
  // 自最近一次已采纳摘要（或会话起点）之后，若已出现未采纳的历史摘要尝试，则仅在真正逼近容量上限时再尝试，避免每轮在增长线上重复空耗输入 token。
  let lastAdoptedIndex = -1;
  if (summary) {
    for (let index = context.inferenceHistory.length - 1; index >= 0; index--) {
      if (context.inferenceHistory[index]!.requestId === summary.requestId) {
        lastAdoptedIndex = index;
        break;
      }
    }
  }
  const hasFailedCompactionSinceAdopted = context.inferenceHistory
    .slice(lastAdoptedIndex + 1)
    .some(request => request.purpose === 'compaction' && request.status === 'completed');
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
      const trimmed = boundToolResults(prepared, context, step.params.minSavingsRatio);
      const after = measureWindow(trimmed, context.inference);
      if (!after || after.estimatedInputTokens >= beforeTokens) {
        blocked.add(step.id);
        continue;
      }
      prepared = trimmed;
      applied.push({ stepId: step.id, kind: step.kind, reason, beforeTokens, afterTokens: after.estimatedInputTokens });
      blocked.clear();
      continue;
    }

    if (reason === 'growth' && hasFailedCompactionSinceAdopted) {
      blocked.add(step.id);
      continue;
    }

    const plan = planCompaction(effect, context, recentTargetTokens(step, metrics), summary, prepared, step.params);
    if (!plan) {
      blocked.add(step.id);
      continue;
    }
    // 响应已确认但尚未采用时复用原响应；无效响应也不重复花费。
    const reusable = compactionRequests.find(request => request.status === 'completed'
      && requestIdentity(request.request) === requestIdentity(plan.request));
    // 已确认响应的采用不再调用模型，额度耗尽时仍允许恢复；仅拒绝新增摘要请求。
    if (!reusable && compactionRequests.length >= MAX_COMPACTIONS) {
      blocked.add(step.id);
      continue;
    }
    const record = reusable ?? await callCompaction(plan.request);
    if (!reusable) compactionRequests.push(record);
    let candidate: InferEffect;
    let afterTokens: number;
    try {
      validateCompaction(record.result!, effect.messages.slice(effect.promptPrefixCount, effect.promptPrefixCount + plan.coveredMessageCount));
      candidate = build({
        effectId: context.effectId,
        requestId: record.requestId,
        coveredMessageCount: plan.coveredMessageCount,
        summary: record.result!.content,
      });
      const after = measureWindow(candidate, context.inference);
      if (!after || after.method !== window.method || after.inputLimit !== window.inputLimit
        || after.outputReserve !== window.outputReserve || after.safetyMargin !== window.safetyMargin) {
        throw new OperationRejected('摘要前后的窗口计量口径发生变化，不能核实压缩收益，未采用摘要。', 'CONTEXT_MEASUREMENT_CHANGED');
      }
      if (after.estimatedInputTokens >= beforeTokens) {
        throw new OperationRejected('摘要没有减少完整模型输入，未采用该摘要。', 'CONTEXT_COMPACTION_NO_GAIN');
      }
      afterTokens = after.estimatedInputTokens;
    } catch (error) {
      if (!(error instanceof OperationRejected) || !RECOVERABLE_COMPACTION_ERRORS.has(error.code)) throw error;
      // 先尝试后续步骤；若最终仍超窗，再保留最后一次摘要失败的具体原因。
      lastCompactionError = error;
      blocked.add(step.id);
      continue;
    }
    summary = await context.commitCompaction(record.requestId, plan.coveredMessageCount);
    prepared = candidate;
    applied.push({ stepId: step.id, kind: step.kind, reason, beforeTokens, afterTokens });
    blocked.clear();
  }

  const finalWindow = measureWindow(prepared, context.inference);
  if (lastCompactionError && finalWindow && finalWindow.estimatedInputTokens > finalWindow.inputLimit) {
    throw lastCompactionError;
  }
  return {
    request: prepared,
    ...(finalWindow ? { plan: {
      profileId: profile.id,
      profileName: profile.name,
      profileRevision: profile.revision,
      beforeTokens: initialWindow.estimatedInputTokens,
      afterTokens: finalWindow.estimatedInputTokens,
      inputLimit: finalWindow.inputLimit,
      steps: applied,
    } } : {}),
  };
}
