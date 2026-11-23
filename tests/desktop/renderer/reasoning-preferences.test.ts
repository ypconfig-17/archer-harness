/** 每个模型的推理等级刷新后保留，非法本机配置不能进入提交。 */
import { afterEach, expect, it, vi } from 'vitest';
import type { ContextProfile } from '@archer/contracts';
const saved = new Map<string, string>();
async function preferences() {
  vi.resetModules();
  vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) });
  vi.stubGlobal('window', { localStorage: globalThis.localStorage });
  return (await import('../../../apps/desktop/renderer/src/store/preferences')).usePreferences;
}
afterEach(() => { saved.clear(); vi.unstubAllGlobals(); });
it('切换模型与刷新后，各模型等级独立保留', async () => {
  const store = await preferences(); store.getState().setReasoning('deepseek-flash', 'max'); store.getState().setReasoning('other-model', 'low');
  expect((await preferences()).getState().reasoningByModel).toEqual({ 'deepseek-flash': 'max', 'other-model': 'low' });
});
it('过滤不支持的等级标识', async () => {
  saved.set('archer-preferences', JSON.stringify({ state: { reasoningByModel: { good: 'high', bad: 'invented' } }, version: 0 }));
  expect((await preferences()).getState().reasoningByModel).toEqual({ good: 'high' });
});
it('保留全局字号并将非法值恢复为中档', async () => {
  const store = await preferences();
  store.getState().setFontSize('large');
  expect((await preferences()).getState().fontSize).toBe('large');
  saved.set('archer-preferences', JSON.stringify({ state: { fontSize: 'huge' }, version: 0 }));
  expect((await preferences()).getState().fontSize).toBe('medium');
});

const customProfile: ContextProfile = {
  version: 1, id: 'custom-a', name: '快照配置', description: '', revision: 1,
  steps: [{ kind: 'compact', id: 'compact-1', enabled: true, params: { reserveTokens: 0, growthTokens: 60_000, keepRecentTokens: 4_000, summaryBudgetTokens: 0 } }],
};

it('自定义 Profile 和任务预算刷新后保留，保存递增修订且内置模板不可覆盖', async () => {
  const store = await preferences();
  store.getState().saveContextProfile(customProfile);
  store.getState().setTokenBudget(50_000);
  const fresh = await preferences();
  expect(fresh.getState()).toMatchObject({ activeContextProfileId: 'custom-a', tokenBudget: 50_000, customContextProfiles: [customProfile] });
  fresh.getState().saveContextProfile({ ...customProfile, name: '改名后' });
  expect(fresh.getState().customContextProfiles[0]).toMatchObject({ name: '改名后', revision: 2 });
  expect(() => fresh.getState().saveContextProfile({ ...customProfile, id: 'balanced' })).toThrow('内置模板只读');
  expect(() => fresh.getState().saveContextProfile({ ...customProfile, id: 'custom-empty', steps: [] })).toThrow();
  expect(() => fresh.getState().setTokenBudget(-1)).toThrow();
  // 复制出的自定义副本使用新标识，不修改来源模板。
  const { copyContextProfile } = await import('../../../apps/desktop/renderer/src/store/preferences');
  const copy = copyContextProfile(customProfile);
  expect(copy.id).toMatch(/^custom-[a-f0-9]{8}$/);
  expect(copy).toMatchObject({ name: '快照配置 副本', revision: 1 });
  fresh.getState().deleteContextProfile('custom-a');
  expect(fresh.getState()).toMatchObject({ activeContextProfileId: 'balanced', customContextProfiles: [] });
});

it('持久化中无效或冒用内置标识的配置被丢弃，生效项回退默认模板', async () => {
  saved.set('archer-preferences', JSON.stringify({ state: {
    customContextProfiles: [{ ...customProfile, id: 'balanced' }, { ...customProfile, id: 'custom-bad', steps: [] }],
    activeContextProfileId: 'custom-bad',
    tokenBudget: -1,
  }, version: 0 }));
  expect((await preferences()).getState()).toMatchObject({ customContextProfiles: [], activeContextProfileId: 'balanced', tokenBudget: null });
});
