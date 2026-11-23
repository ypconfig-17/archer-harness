/** 界面只保存导航位置，会话事实仍从服务端读取。 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { usePreferences } from './preferences';
const serviceKey = window.archerDesktop?.serviceKey || window.location.origin;
export type View = { type: 'home' } | { type: 'agent'; agentId: string };
function locationView(): View {
  const match = window.location.hash.match(/^#agent\/(.+)$/);
  try { return match ? { type: 'agent', agentId: decodeURIComponent(match[1]!) } : { type: 'home' }; }
  catch { return { type: 'home' }; }
}
interface UiState { view: View; selectAgent(id: string): void; openNewAgent(): void; clear(): void; }
function navigate(view: View) {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${view.type === 'agent' ? `#agent/${encodeURIComponent(view.agentId)}` : ''}`);
  return { view };
}
export const useUiStore = create<UiState>()(persist(set => ({
  view: locationView(),
  selectAgent: agentId => set(navigate({ type: 'agent', agentId })),
  openNewAgent: () => set(navigate({ type: 'home' })),
  clear: () => set(navigate({ type: 'home' })),
}), {
  name: `archer-navigation:${serviceKey}`,
  partialize: ({ view }) => ({ view }),
  // 显式会话地址优先；「启动时打开新对话」覆盖上次导航，但不覆盖显式地址。
  merge: (persisted, current) => {
    const explicit = locationView();
    if (explicit.type === 'agent') return { ...current, view: explicit };
    if (usePreferences.getState().startup === 'new') return current;
    const saved = (persisted as { view?: View } | undefined)?.view;
    return saved?.type === 'agent' && typeof saved.agentId === 'string'
      ? { ...current, ...navigate(saved) } : current;
  },
}));
window.addEventListener('hashchange', () => useUiStore.setState({ view: locationView() }));
