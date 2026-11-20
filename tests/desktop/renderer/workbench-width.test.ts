import { afterEach, expect, it, vi } from 'vitest';

// 宽度是本机偏好，只约束下界；上界由实际面板容器决定。
afterEach(() => vi.unstubAllGlobals());
it('工作台可保存超过旧上限的宽度并在重新加载时恢复', async () => {
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
  vi.stubGlobal('window', { localStorage: globalThis.localStorage });
  vi.resetModules();
  const first = (await import('../../../apps/desktop/renderer/src/store/workbench')).useWorkbench;
  first.getState().setInspectorWidth(780);
  expect(first.getState().inspectorWidth).toBe(780);
  vi.resetModules();
  const reopened = (await import('../../../apps/desktop/renderer/src/store/workbench')).useWorkbench;
  expect(reopened.getState().inspectorWidth).toBe(780);
  reopened.getState().setInspectorWidth(100);
  expect(reopened.getState().inspectorWidth).toBe(320);
});
