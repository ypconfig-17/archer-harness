/** 布局是本机偏好，不参与 Agent 事实回放。 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** 工作台是右栏的阅读对象；首页本身也属于同一组视图。 */
export type WorkbenchView = 'workbench' | 'review' | 'workspace' | 'activity' | 'overview';

interface WorkbenchState {
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  inspectorOpen: boolean;
  inspectorWidth: number;
  inspectorView: WorkbenchView;
  toggleSidebar(): void;
  setSidebarWidth(width: number): void;
  setInspectorOpen(open: boolean): void;
  setInspectorWidth(width: number): void;
  setInspectorView(view: WorkbenchView): void;
}
export const useWorkbench = create<WorkbenchState>()(persist(set => ({
  sidebarCollapsed: false,
  sidebarWidth: 320,
  inspectorOpen: false,
  inspectorWidth: 400,
  // 视图不持久化：每次启动都从工作台首页开始，不停留在上次的阅读对象。
  inspectorView: 'workbench',
  toggleSidebar: () => set(state => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  // 侧栏宽度由拖动决定，限制在既能读长标题又不挤占正文的区间。
  setSidebarWidth: width => set({ sidebarWidth: Math.max(260, Math.min(420, width)) }),
  setInspectorOpen: inspectorOpen => set({ inspectorOpen }),
  setInspectorView: inspectorView => set({ inspectorView }),
  // 只保存有效像素偏好；实际最大宽度由面板按容器比例与会话最小宽度约束。
  setInspectorWidth: width => set({ inspectorWidth: Number.isFinite(width) ? Math.max(320, width) : 400 }),
}), {
  name: 'archer-workbench',
  // 只恢复当前仍存在的布局字段；旧版本遗留的检查器页签字段一律忽略。
  merge: (persisted, current) => {
    if (!persisted || typeof persisted !== 'object') return current;
    const saved = persisted as Partial<WorkbenchState>;
    return {
      ...current,
      sidebarCollapsed: typeof saved.sidebarCollapsed === 'boolean' ? saved.sidebarCollapsed : current.sidebarCollapsed,
      sidebarWidth: typeof saved.sidebarWidth === 'number' && Number.isFinite(saved.sidebarWidth)
        ? Math.max(260, Math.min(420, saved.sidebarWidth))
        : current.sidebarWidth,
      inspectorOpen: typeof saved.inspectorOpen === 'boolean' ? saved.inspectorOpen : current.inspectorOpen,
      inspectorWidth: typeof saved.inspectorWidth === 'number' && Number.isFinite(saved.inspectorWidth)
        ? Math.max(320, saved.inspectorWidth)
        : current.inspectorWidth,
    };
  },
}));
