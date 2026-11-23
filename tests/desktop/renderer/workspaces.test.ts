import { afterEach, expect, it, vi } from 'vitest';

const saved = new Map<string, string>();
async function open(serviceKey = 'desktop-local') {
  vi.resetModules();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
  vi.stubGlobal('window', {
    archerDesktop: { serviceKey },
    location: { origin: 'file://' },
    localStorage: globalThis.localStorage,
  });
  return (await import('../../../apps/desktop/renderer/src/store/workspaces')).useWorkspaceNavigation;
}
afterEach(() => {
  saved.clear();
  vi.unstubAllGlobals();
});

it('隐藏只影响导航，恢复后重新显示且不丢失记录', async () => {
  const store = await open();
  store.getState().select('/tmp/a');
  store.getState().hide('/tmp/a');
  expect(store.getState().hidden).toEqual(['/tmp/a']);
  expect(store.getState().selected).toBeNull();

  store.getState().unhide('/tmp/a');
  expect(store.getState().hidden).toEqual([]);
  expect(store.getState().recent).toEqual(['/tmp/a']);
});

it('移除记录清除本机导航偏好，重新打开后不再恢复', async () => {
  const store = await open();
  store.getState().select('/tmp/a');
  store.getState().select('/tmp/b');
  store.getState().hide('/tmp/a');
  store.getState().forget('/tmp/a');
  expect(store.getState().recent).toEqual(['/tmp/b']);
  expect(store.getState().hidden).toEqual([]);

  const reopened = await open();
  expect(reopened.getState().recent).toEqual(['/tmp/b']);
  expect(reopened.getState().hidden).toEqual([]);
});


it('选择已有项目不置顶，新项目追加且重新打开保留顺序', async () => {
  const store = await open();
  store.getState().select('/tmp/a');
  store.getState().select('/tmp/b');
  store.getState().select('/tmp/a');
  expect(store.getState().selected).toBe('/tmp/a');
  expect(store.getState().recent).toEqual(['/tmp/a', '/tmp/b']);

  const reopened = await open();
  expect(reopened.getState().recent).toEqual(['/tmp/a', '/tmp/b']);
});
