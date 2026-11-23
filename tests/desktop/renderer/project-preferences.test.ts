/** 项目默认选择持久化，但不替代每次任务提交的授权。 */
import { afterEach, expect, it, vi } from 'vitest';
const saved = new Map<string, string>();
async function open(serviceKey = 'local') {
  vi.resetModules();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
  vi.stubGlobal('window', { archerDesktop: { serviceKey }, location: { origin: 'file://' }, localStorage: globalThis.localStorage });
  return (await import('../../../apps/desktop/renderer/src/store/project-preferences')).useProjectPreferences;
}
afterEach(() => { saved.clear(); vi.unstubAllGlobals(); });
it('刷新后保留同一项目的选择，其他项目默认不继承', async () => {
  (await open()).getState().setCommandMode('/projects/a', 'auto');
  const state = (await open()).getState();
  expect(state.commandModes['/projects/a']).toBe('auto');
  expect(state.commandModes['/projects/b']).toBeUndefined();
});
it('不同服务不共享审批模式', async () => {
  (await open()).getState().setCommandMode('/projects/a', 'full');
  expect((await open('remote')).getState().commandModes['/projects/a']).toBeUndefined();
});
it('忽略无法识别的持久化模式', async () => {
  saved.set('archer-project-preferences:local', JSON.stringify({ state: { commandModes: { a: 'invalid', b: 'ask' } }, version: 0 }));
  expect((await open()).getState().commandModes).toEqual({ b: 'ask' });
});
