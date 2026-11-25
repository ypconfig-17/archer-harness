/**
 * 上下文整理策略模拟投影（纯计算）。
 *
 * 严格对齐 packages/handler/src/context-policy.ts 的运行时边界规则：
 * - 容量预留上限为输入额度的 15%；
 * - 近期保护上限为输入额度的 25%；
 * - 工具结果节选从输入额度的 85% 容量线启动。
 */
import type { ContextProfile } from '@archer/contracts';

export const CONTEXT_WINDOW_PRESETS = [
  { value: '128000', label: '128K', tokens: 128_000 },
  { value: '200000', label: '200K', tokens: 200_000 },
  { value: '256000', label: '256K', tokens: 256_000 },
  { value: '1000000', label: '1M', tokens: 1_000_000 },
] as const;

export type ContextWindowPreset = (typeof CONTEXT_WINDOW_PRESETS)[number]['value'];

export interface ContextSimulation {
  inputLimit: number;
  compactEnabled: boolean;
  trimEnabled: boolean;
  trimTriggerTokens: number;
  effectiveReserveTokens: number;
  reserveCapped: boolean;
  compactTriggerTokens: number;
  compactTriggerPercent: number;
  effectiveKeepRecentTokens: number;
  keepRecentCapped: boolean;
  keepRecentPercent: number;
  reclaimableTokens: number;
  reclaimRatioPercent: number;
  growthTokens: number;
}

/** 根据选定模型参考窗口与当前 Profile，估算真实触发线与保留原文上限。 */
export function simulateContextProfile(
  profile: ContextProfile,
  inputLimit: number,
): ContextSimulation {
  const safeLimit = Math.max(1, Math.floor(inputLimit));
  const compact = profile.steps.find(
    (step): step is Extract<ContextProfile['steps'][number], { kind: 'compact' }> =>
      step.kind === 'compact' && step.enabled,
  );
  const trim = profile.steps.find(
    (step) => step.kind === 'trim-tool-results' && step.enabled,
  );

  const trimTriggerTokens = Math.floor(safeLimit * 0.85);
  const maxReserve = Math.floor(safeLimit * 0.15);
  const maxKeepRecent = Math.floor(safeLimit * 0.25);

  if (!compact) {
    return {
      inputLimit: safeLimit,
      compactEnabled: false,
      trimEnabled: Boolean(trim),
      trimTriggerTokens,
      effectiveReserveTokens: 0,
      reserveCapped: false,
      compactTriggerTokens: safeLimit,
      compactTriggerPercent: 100,
      effectiveKeepRecentTokens: safeLimit,
      keepRecentCapped: false,
      keepRecentPercent: 100,
      reclaimableTokens: 0,
      reclaimRatioPercent: 0,
      growthTokens: 0,
    };
  }

  const effectiveReserveTokens = Math.min(compact.params.reserveTokens, maxReserve);
  const compactTriggerTokens = Math.max(0, safeLimit - effectiveReserveTokens);
  const effectiveKeepRecentTokens = Math.min(compact.params.keepRecentTokens, maxKeepRecent);
  const reclaimableTokens = Math.max(0, compactTriggerTokens - effectiveKeepRecentTokens);
  const reclaimRatioPercent =
    compactTriggerTokens > 0
      ? Number(((reclaimableTokens / compactTriggerTokens) * 100).toFixed(1))
      : 0;

  return {
    inputLimit: safeLimit,
    compactEnabled: true,
    trimEnabled: Boolean(trim),
    trimTriggerTokens,
    effectiveReserveTokens,
    reserveCapped: compact.params.reserveTokens > maxReserve,
    compactTriggerTokens,
    compactTriggerPercent: Number(((compactTriggerTokens / safeLimit) * 100).toFixed(1)),
    effectiveKeepRecentTokens,
    keepRecentCapped: compact.params.keepRecentTokens > maxKeepRecent,
    keepRecentPercent: Number(((effectiveKeepRecentTokens / safeLimit) * 100).toFixed(1)),
    reclaimableTokens,
    reclaimRatioPercent,
    growthTokens: compact.params.growthTokens,
  };
}
