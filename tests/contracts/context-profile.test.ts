/** 上下文 Profile 的协议校验与内置模板边界按对外行为验证。 */
import { expect, it } from 'vitest';
import {
  DEFAULT_CONTEXT_PROFILE_ID,
  InferConfigSchema,
  ContextProfileSchema,
  builtinContextProfile,
  builtinContextProfiles,
  defaultContextProfile,
  isBuiltinContextProfile,
  resolveContextProfile,
  validateContextProfile,
  type ContextCondition,
  type ContextProfile,
  type ContextStep,
} from '@archer/contracts';

type CompactStep = Extract<ContextStep, { kind: 'compact' }>;
function compactStep(overrides: Partial<CompactStep> = {}, params: Partial<CompactStep['params']> = {}): CompactStep {
  return {
    kind: 'compact',
    id: 'compact-1',
    enabled: true,
    params: { reserveTokens: 0, growthTokens: 60_000, keepRecentTokens: 4_000, summaryBudgetTokens: 0, ...params },
    ...overrides,
  };
}
function profile(overrides: Partial<ContextProfile> = {}): ContextProfile {
  return {
    version: 1,
    id: 'custom-a',
    name: '自定义配置',
    description: '',
    revision: 1,
    steps: [compactStep()],
    ...overrides,
  };
}

it('内置模板全部通过校验，默认模板返回独立副本', () => {
  const builtins = builtinContextProfiles();
  expect(builtins).toHaveLength(3);
  for (const item of builtins) expect(validateContextProfile(item)).toEqual([]);
  expect(DEFAULT_CONTEXT_PROFILE_ID).toBe('balanced');
  expect(defaultContextProfile()).toMatchObject({ id: 'balanced', name: '均衡模式' });
  const copy = builtinContextProfile('quality')!;
  copy.steps[0]!.enabled = false;
  expect(builtinContextProfile('quality')!.steps[0]!.enabled).toBe(true);
  expect(isBuiltinContextProfile('custom-a')).toBe(false);
});

it('解析生效配置时自定义优先，未知标识回退默认模板', () => {
  const custom = profile({ id: 'custom-b', name: '本机配置' });
  expect(resolveContextProfile('custom-b', [custom])).toMatchObject({ name: '本机配置' });
  expect(resolveContextProfile('token-saver')).toMatchObject({ name: 'Token 优化优先' });
  expect(resolveContextProfile('missing')).toMatchObject({ id: DEFAULT_CONTEXT_PROFILE_ID });
  // 解析结果始终是副本，页面草稿修改不会写回来源。
  const resolved = resolveContextProfile('custom-b', [custom]);
  resolved.name = '改过';
  expect(custom.name).toBe('本机配置');
});

it('拒绝无法执行或会悄悄改变语义的配置', () => {
  const duplicate = profile({ steps: [
    { kind: 'compact', id: 'same', enabled: true, params: { reserveTokens: 0, growthTokens: 1, keepRecentTokens: 1, summaryBudgetTokens: 0 } },
    { kind: 'trim-tool-results', id: 'same', enabled: true, params: { minSavingsRatio: 0.25 } },
  ] });
  expect(validateContextProfile(duplicate).map(issue => issue.message)).toEqual([expect.stringContaining('步骤标识重复')]);
  const twoTrims = profile({ steps: [
    { kind: 'trim-tool-results', id: 'trim-1', enabled: true, params: { minSavingsRatio: 0.2 } },
    { kind: 'trim-tool-results', id: 'trim-2', enabled: true, params: { minSavingsRatio: 0.3 } },
  ] });
  expect(validateContextProfile(twoTrims).map(issue => issue.message)).toEqual([expect.stringContaining('最多启用一个工具结果节选步骤')]);
  let nested: ContextCondition = { kind: 'compare', metric: 'historyMessages', op: 'gte', value: 1 };
  for (let depth = 0; depth < 5; depth++) nested = { kind: 'all', conditions: [nested] };
  const deep = profile({ steps: [compactStep({ when: nested })] });
  expect(validateContextProfile(deep).map(issue => issue.message)).toEqual([expect.stringContaining('最多嵌套 4 层')]);
  expect(validateContextProfile({ ...profile(), steps: [] }).map(issue => issue.message)).toEqual([expect.stringContaining('至少保留一个步骤')]);
  expect(validateContextProfile(profile({ id: 'Bad ID' })).map(issue => issue.message)).toEqual([expect.stringContaining('只能使用小写字母、数字和连字符')]);
});

it('步骤参数与条件结构使用同一份 Schema 校验', () => {
  const invalidBudget = profile({ steps: [compactStep({}, { summaryBudgetTokens: 500 })] });
  expect(validateContextProfile(invalidBudget).map(issue => issue.message)).toEqual([expect.stringContaining('摘要预算至少 1,024')]);
  const negativeGrowth = profile({ steps: [compactStep({}, { growthTokens: 0 })] });
  expect(validateContextProfile(negativeGrowth).map(issue => issue.message)).toEqual([expect.stringContaining('增长阈值必须大于 0')]);
  const emptyGroup = profile({ steps: [compactStep({ when: { kind: 'any', conditions: [] } })] });
  expect(validateContextProfile(emptyGroup).map(issue => issue.message)).toEqual([expect.stringContaining('条件组至少包含一项')]);
});

it('API 与事实 Schema 拒绝重复步骤、多重节选和超深条件，不依赖页面预检', () => {
  let deep: ContextCondition = { kind: 'compare', metric: 'historyMessages', op: 'gte', value: 1 };
  for (let depth = 0; depth < 4; depth++) deep = { kind: 'all', conditions: [deep] };
  const many: ContextCondition = {
    kind: 'all',
    conditions: Array.from({ length: 4 }, () => ({
      kind: 'any',
      conditions: Array.from({ length: 7 }, () => ({
        kind: 'compare', metric: 'historyMessages', op: 'gte', value: 1,
      })),
    })),
  };
  const invalidProfiles = [
    profile({ steps: [compactStep(), compactStep()] }),
    profile({ steps: ['trim-a', 'trim-b'].map(id => ({
      kind: 'trim-tool-results', id, enabled: true, params: { minSavingsRatio: 0.25 },
    })) }),
    profile({ steps: [compactStep({ when: deep })] }),
    profile({ steps: [compactStep({ when: many })] }),
  ];
  for (const invalid of invalidProfiles) {
    expect(ContextProfileSchema.safeParse(invalid).success).toBe(false);
    expect(InferConfigSchema.safeParse({ contextProfile: invalid }).success).toBe(false);
  }
});
