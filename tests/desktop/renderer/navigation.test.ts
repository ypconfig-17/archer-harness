import { afterEach, expect, it, vi } from 'vitest';

const saved = new Map<string, string>();
async function open(hash = '', serviceKey = 'desktop-local') {
  vi.resetModules();
  const location = { hash, pathname: '/', search: '', origin: 'file://' };
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
  vi.stubGlobal('window', {
    archerDesktop: { serviceKey }, location, localStorage: globalThis.localStorage,
    history: { replaceState: (_state: unknown, _title: string, url: string) => { location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : ''; } },
    addEventListener: () => {},
  });
  return (await import('../../../apps/desktop/renderer/src/store/ui')).useUiStore;
}
afterEach(() => { saved.clear(); vi.unstubAllGlobals(); });

it('重开页面恢复上次选择的会话，显式会话链接优先', async () => {
  const initial = await open();
  initial.getState().selectAgent('chat-a');
  expect((await open()).getState().view).toEqual({ type: 'agent', agentId: 'chat-a' });
  expect((await open('#agent/chat-b')).getState().view).toEqual({ type: 'agent', agentId: 'chat-b' });
});

it('切换服务不串用导航，主动回到新对话后不再次打开旧会话', async () => {
  (await open()).getState().selectAgent('chat-a');
  expect((await open('', 'other-service')).getState().view).toEqual({ type: 'home' });
  (await open()).getState().openNewAgent();
  expect((await open()).getState().view).toEqual({ type: 'home' });
});
