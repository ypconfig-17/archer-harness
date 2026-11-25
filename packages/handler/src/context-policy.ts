/**
 * 声明式上下文策略引擎。
 *
 * 只读取本地估算快照并选择「链中第一个满足条件的步骤」：
 * 条件本身不触发整理，步骤自身的容量线、增长线或超窗线才是触发依据。
 * 纯计算，不调用 Provider、不提交事实、不访问时钟。
 */
import type {
  ContextCondition,
  ContextMetric,
  ContextMetrics,
  ContextProfile,
  ContextStep,
  InferEffect,
  Inference,
} from '@archer/contracts';

/** 步骤触发原因；与 `contextPlan` 事实中的取值保持一致。 */
export type ContextStepReason = 'capacity' | 'growth' | 'overflow';

export interface ContextStepSelection {
  step: ContextStep;
  reason: ContextStepReason;
}

/**
 * 估算尚未被已采用摘要覆盖的原始历史体积。
 * 用“前缀 + 未覆盖历史”与“仅前缀”两次计量之差剥离系统提示、工具声明和协议开销，
 * 使增长阈值与固定开销和窗口大小无关。缺少计量能力时返回 undefined，退回容量线。
 */
export function measureUncoveredHistory(effect: InferEffect, inference: Inference, coveredMessageCount: number): number | undefined {
  if (!inference.measure) return undefined;
  const prefix = effect.messages.slice(0, effect.promptPrefixCount);
  const uncovered = effect.messages.slice(effect.promptPrefixCount + coveredMessageCount);
  if (uncovered.length === 0) return 0;
  const base = inference.measure({ ...effect, messages: prefix });
  const grown = inference.measure({ ...effect, messages: [...prefix, ...uncovered] });
  if (!base || !grown || !Number.isSafeInteger(base.estimatedInputTokens) || !Number.isSafeInteger(grown.estimatedInputTokens)) return undefined;
  return Math.max(0, grown.estimatedInputTokens - base.estimatedInputTokens);
}

/** 指标缺失时条件不成立；`inputRatio` 在零额度窗口上同样视为不可判定。 */
export function conditionMatches(condition: ContextCondition, metrics: ContextMetrics): boolean {
  if (condition.kind === 'compare') {
    const actual = metricValue(condition.metric, metrics);
    if (actual === undefined) return false;
    switch (condition.op) {
      case 'gte': return actual >= condition.value;
      case 'gt': return actual > condition.value;
      case 'lte': return actual <= condition.value;
      case 'lt': return actual < condition.value;
    }
  }
  return condition.kind === 'all'
    ? condition.conditions.every(item => conditionMatches(item, metrics))
    : condition.conditions.some(item => conditionMatches(item, metrics));
}

function metricValue(metric: ContextMetric, metrics: ContextMetrics): number | undefined {
  switch (metric) {
    case 'estimatedInputTokens': return metrics.estimatedInputTokens;
    case 'inputRatio': return metrics.inputLimit > 0 ? metrics.estimatedInputTokens / metrics.inputLimit : undefined;
    case 'uncoveredTokens': return metrics.uncoveredTokens;
    case 'historyMessages': return metrics.historyMessages;
    default: return undefined;
  }
}

/** 若 Profile 指定了大窗口实用工作区上限，则与模型可用输入额度取小值。 */
export function effectiveWindowLimit(profile: Pick<ContextProfile, 'targetWindowTokens'> | undefined, inputLimit: number): number {
  return profile?.targetWindowTokens && profile.targetWindowTokens > 0
    ? Math.min(inputLimit, profile.targetWindowTokens)
    : inputLimit;
}

/**
 * 触发线：
 * - 摘要步骤在容量线或增长线命中时执行；容量线实际预留不超过有效工作区上限的 15%。
 * - 工具结果节选在有效工作区上限 85% 容量线启动，超窗仍明确记为补救。
 */
function triggerReason(step: ContextStep, metrics: ContextMetrics, effectiveLimit: number): ContextStepReason | undefined {
  if (step.kind === 'trim-tool-results') {
    if (metrics.estimatedInputTokens > metrics.inputLimit) return 'overflow';
    // 提前释放可重读的大结果，避免直到硬超窗或 1M 窗口深处才开始补救。
    return metrics.estimatedInputTokens > Math.floor(effectiveLimit * 0.85) ? 'capacity' : undefined;
  }
  const reserve = Math.min(step.params.reserveTokens, Math.floor(effectiveLimit * 0.15));
  if (metrics.estimatedInputTokens > effectiveLimit - reserve) return 'capacity';
  if (metrics.uncoveredTokens !== undefined && metrics.uncoveredTokens > step.params.growthTokens) return 'growth';
  return undefined;
}

/**
 * 选择链中第一个启用、条件成立且触发线命中的步骤。
 * `blocked` 保存本轮已经确认无收益的步骤，避免同一快照上反复尝试。
 */
export function selectContextStep(
  profile: ContextProfile,
  metrics: ContextMetrics,
  blocked: ReadonlySet<string> = new Set(),
): ContextStepSelection | undefined {
  const effectiveLimit = effectiveWindowLimit(profile, metrics.inputLimit);
  for (const step of profile.steps) {
    if (!step.enabled || blocked.has(step.id)) continue;
    if (step.when && !conditionMatches(step.when, metrics)) continue;
    const reason = triggerReason(step, metrics, effectiveLimit);
    if (reason) return { step, reason };
  }
  return undefined;
}

/** 摘要后仍需保留的近期原文目标；绝对值不超过有效工作区上限的 25%。 */
export function recentTargetTokens(
  step: Extract<ContextStep, { kind: 'compact' }>,
  metrics: ContextMetrics,
  profile?: Pick<ContextProfile, 'targetWindowTokens'>,
): number {
  const effectiveLimit = effectiveWindowLimit(profile, metrics.inputLimit);
  return Math.min(step.params.keepRecentTokens, Math.floor(effectiveLimit * 0.25));
}

function usesUncoveredMetric(condition: ContextCondition): boolean {
  if (condition.kind === 'compare') return condition.metric === 'uncoveredTokens';
  return condition.conditions.some(usesUncoveredMetric);
}

/** 摘要步骤和引用未覆盖历史的触发条件都需要该估算；否则跳过额外计量。 */
export function needsUncoveredTokens(profile: ContextProfile): boolean {
  return profile.steps.some(step => step.enabled
    && (step.kind === 'compact' || (step.when ? usesUncoveredMetric(step.when) : false)));
}
