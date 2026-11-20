/** 草稿只在当前页面进程内保留，切换会话不会丢失，也不写入事件日志。 */
import { create } from 'zustand';

interface DraftState {
  drafts: Record<string, string>;
  setDraft(key: string, value: string): void;
}
const useDrafts = create<DraftState>(set => ({
  drafts: {},
  setDraft: (key, value) => set(state => {
    const drafts = { ...state.drafts };
    if (value) drafts[key] = value;
    else delete drafts[key];
    return { drafts };
  }),
}));
/** 会话删除后释放本地草稿，避免已删除会话继续占用页面内存。 */
export function clearSessionDraft(agentId: string): void {
  useDrafts.getState().setDraft(`agent:${agentId}`, '');
}

export function useDraft(key: string): [string, (value: string) => void] {
  const value = useDrafts(state => state.drafts[key] ?? '');
  const update = useDrafts(state => state.setDraft);
  return [value, value => update(key, value)];
}
