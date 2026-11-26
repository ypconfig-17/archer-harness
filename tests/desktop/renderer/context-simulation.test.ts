/** 上下文压缩模拟器：验证 15% 预留上限、25% 近期保护上限、85% 节选线与停用摘要回退。 */
import { describe, expect, it } from 'vitest';
import { defaultContextProfile } from '@archer/contracts';
import { simulateContextProfile } from '../../../apps/desktop/renderer/src/lib/context-simulation';

describe('simulateContextProfile 上下文压缩模拟', () => {
  it('按 15% 预留上限与 25% 近期保护上限计算 128K 窗口模拟结果', () => {
    const profile = defaultContextProfile();
    const compact = profile.steps.find((s) => s.kind === 'compact');
    if (compact?.kind === 'compact') {
      compact.params.reserveTokens = 50_000; // 超过 128K * 15% = 19,200
      compact.params.keepRecentTokens = 50_000; // 超过 128K * 25% = 32,000
      compact.params.growthTokens = 28_000;
    }

    const sim = simulateContextProfile(profile, 128_000);
    expect(sim.compactEnabled).toBe(true);
    expect(sim.reserveCapped).toBe(true);
    expect(sim.effectiveReserveTokens).toBe(19_200);
    expect(sim.compactTriggerTokens).toBe(108_800);
    expect(sim.compactTriggerPercent).toBe(85);
    expect(sim.keepRecentCapped).toBe(true);
    expect(sim.effectiveKeepRecentTokens).toBe(32_000);
    expect(sim.keepRecentPercent).toBe(25);
    expect(sim.reclaimableTokens).toBe(76_800);
    expect(sim.trimTriggerTokens).toBe(108_800);
    expect(sim.growthTokens).toBe(28_000);
  });

  it('未超过比例上限且未封顶时按真实配置数值计算', () => {
    const profile = defaultContextProfile();
    delete profile.targetWindowTokens;
    const compact = profile.steps.find((s) => s.kind === 'compact');
    if (compact?.kind === 'compact') {
      compact.params.reserveTokens = 10_000;
      compact.params.keepRecentTokens = 20_000;
    }

    const sim = simulateContextProfile(profile, 200_000);
    expect(sim.windowCapped).toBe(false);
    expect(sim.reserveCapped).toBe(false);
    expect(sim.effectiveReserveTokens).toBe(10_000);
    expect(sim.compactTriggerTokens).toBe(190_000);
    expect(sim.keepRecentCapped).toBe(false);
    expect(sim.effectiveKeepRecentTokens).toBe(20_000);
    expect(sim.reclaimableTokens).toBe(170_000);
  });

  it('在 1M 大窗口下启用工作区封顶时，按封顶上限计算 85% 节选线与触发线', () => {
    const profile = defaultContextProfile(); // 默认 targetWindowTokens = 160_000
    const sim = simulateContextProfile(profile, 1_000_000);
    expect(sim.windowCapped).toBe(true);
    expect(sim.effectiveLimit).toBe(160_000);
    expect(sim.trimTriggerTokens).toBe(136_000);
    expect(sim.compactTriggerTokens).toBe(143_616);
  });

  it('关闭自动摘要时返回 compactEnabled=false 与 85% 节选触发线', () => {
    const profile = defaultContextProfile();
    for (const step of profile.steps) {
      if (step.kind === 'compact') step.enabled = false;
    }
    const sim = simulateContextProfile(profile, 128_000);
    expect(sim.compactEnabled).toBe(false);
    expect(sim.reclaimableTokens).toBe(0);
    expect(sim.trimTriggerTokens).toBe(108_800);
  });
});
