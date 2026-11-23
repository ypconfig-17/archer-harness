/** 策略链只按声明顺序选择第一个可执行步骤；条件只做过滤，不自行触发整理。 */
import { expect, it } from 'vitest';
import type { ContextCondition, ContextMetrics, ContextProfile, ContextStep } from '@archer/contracts';
import { conditionMatches, recentTargetTokens, selectContextStep } from '@archer/handler';

type CompactStep = Extract<ContextStep, { kind: 'compact' }>;
function compact(id: string, params: Partial<CompactStep['params']> = {}, when?: ContextCondition): CompactStep {
  return {
    kind: 'compact', id, enabled: true,
    ...(when ? { when } : {}),
    params: { reserveTokens: 10_000, growthTokens: 100_000, keepRecentTokens: 20_000, summaryBudgetTokens: 0, ...params },
  };
}
function trim(id: string, when?: ContextCondition): ContextStep {
  return {
    kind: 'trim-tool-results', id, enabled: true,
    ...(when ? { when } : {}),
    params: { minSavingsRatio: 0.25 },
  };
}
function profile(steps: ContextStep[]): ContextProfile {
  return { version: 1, id: 'custom-chain', name: '链式配置', description: '', revision: 1, steps };
}
const metrics: ContextMetrics = { estimatedInputTokens: 80_000, inputLimit: 88_000, historyMessages: 12, uncoveredTokens: 30_000 };

it('ANY / ALL 可嵌套组合，缺失的指标让比较不成立', () => {
  const nested: ContextCondition = {
    kind: 'any',
    conditions: [
      { kind: 'all', conditions: [
        { kind: 'compare', metric: 'inputRatio', op: 'gte', value: 0.9 },
        { kind: 'compare', metric: 'historyMessages', op: 'gt', value: 10 },
      ] },
      { kind: 'compare', metric: 'uncoveredTokens', op: 'lte', value: 1_000 },
    ],
  };
  expect(conditionMatches(nested, metrics)).toBe(true);
  // 80,000 / 88,000 ≈ 0.909，任一 ALL 子项不成立时整体依赖另一分支。
  expect(conditionMatches(nested, { ...metrics, historyMessages: 3 })).toBe(false);
  expect(conditionMatches({ kind: 'compare', metric: 'uncoveredTokens', op: 'gte', value: 0 }, { estimatedInputTokens: 1, inputLimit: 10, historyMessages: 0 })).toBe(false);
  expect(conditionMatches({ kind: 'compare', metric: 'inputRatio', op: 'gte', value: 0 }, { estimatedInputTokens: 1, inputLimit: 0, historyMessages: 0 })).toBe(false);
});

it('按声明顺序选择第一个启用且条件成立的步骤', () => {
  const first = compact('compact-1');
  const second = compact('compact-2');
  expect(selectContextStep(profile([first, second]), metrics)).toMatchObject({ step: { id: 'compact-1' }, reason: 'capacity' });
  expect(selectContextStep(profile([{ ...first, enabled: false }, second]), metrics)).toMatchObject({ step: { id: 'compact-2' } });
  expect(selectContextStep(profile([first, second]), metrics, new Set(['compact-1']))).toMatchObject({ step: { id: 'compact-2' } });
  // 条件不成立时不再尝试触发线，直接落到下一个步骤。
  expect(selectContextStep(profile([compact('guarded', {}, { kind: 'compare', metric: 'historyMessages', op: 'lt', value: 1 }), second]), metrics)).toMatchObject({ step: { id: 'compact-2' } });
});

it('工具结果节选在容量线提前启动，低占用保持原文', () => {
  expect(selectContextStep(profile([trim('trim-1')]), metrics)).toMatchObject({ reason: 'capacity' });
  expect(selectContextStep(profile([trim('trim-1')]), { ...metrics, estimatedInputTokens: 74_800 })).toBeUndefined();
  expect(selectContextStep(profile([trim('trim-1')]), { ...metrics, estimatedInputTokens: 88_001 })).toMatchObject({ step: { id: 'trim-1' }, reason: 'overflow' });
  // 步骤条件同样适用于超窗补救。
  const guarded = trim('trim-1', { kind: 'compare', metric: 'historyMessages', op: 'gte', value: 99 });
  expect(selectContextStep(profile([guarded]), { ...metrics, estimatedInputTokens: 88_001 })).toBeUndefined();
});

it('近期原文目标同时受绝对参数和输入额度 25% 的限制', () => {
  const step = compact('compact-1', { keepRecentTokens: 50_000 });
  expect(recentTargetTokens(step, metrics)).toBe(22_000);
  expect(recentTargetTokens(step, { ...metrics, inputLimit: 400_000 })).toBe(50_000);
});
