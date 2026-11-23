/** 只保存当前服务的导航偏好，会话归属由服务端 Agent 工作环境决定，未创建会话的目录仅为导航偏好。 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
interface WorkspaceNavigation {
  selected: string | null;
  hidden: string[];
  recent: string[];
  select(root: string): void;
  hide(root: string): void;
  unhide(root: string): void;
  forget(root: string): void;
}
export const useWorkspaceNavigation = create<WorkspaceNavigation>()(persist(set => ({
  selected: null,
  hidden: [],
  recent: [],
  // 选择只更新当前位置；已有目录保留顺序，新目录追加，避免点击后导航跳动。
  select: root => set(state => ({
    selected: root,
    recent: state.recent.includes(root) ? state.recent : [...state.recent, root],
    hidden: state.hidden.filter(path => path !== root),
  })),
  hide: root => set(state => ({ hidden: [...new Set([...state.hidden, root])], selected: state.selected === root ? null : state.selected })),
  unhide: root => set(state => ({ hidden: state.hidden.filter(path => path !== root) })),
  forget: root => set(state => ({ recent: state.recent.filter(path => path !== root), hidden: state.hidden.filter(path => path !== root), selected: state.selected === root ? null : state.selected })),
}), { name: `archer-workspaces:${window.archerDesktop?.serviceKey || window.location.origin}` }));
