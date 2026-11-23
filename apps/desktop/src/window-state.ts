/** 窗口位置只属于桌面偏好；显示器移除后回退到系统默认位置。 */
export interface Rectangle { x: number; y: number; width: number; height: number }
export interface WindowState { bounds: Rectangle; maximized: boolean }
export function restoreWindowState(value: unknown, displays: readonly Rectangle[]): WindowState | undefined {
  if (!value || typeof value !== 'object') return;
  const state = value as Partial<WindowState>;
  const bounds = state.bounds;
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return;
  if (bounds.width < 960 || bounds.height < 640) return;
  // 标题栏必须可见，保证恢复后用户仍能移动窗口。
  const display = displays.find(area => bounds.x >= area.x && bounds.x + 160 <= area.x + area.width && bounds.y >= area.y && bounds.y + 40 <= area.y + area.height);
  if (!display) return;
  return {
    bounds: { x: bounds.x, y: bounds.y, width: Math.min(bounds.width, display.width), height: Math.min(bounds.height, display.height) },
    maximized: state.maximized === true,
  };
}

/** 切换普通窗口尺寸；全屏与不可最大化窗口交还系统，不强制退出全屏。 */
export function toggleWindowMaximize(window: {
  isFullScreen(): boolean;
  isMaximizable(): boolean;
  isMaximized(): boolean;
  maximize(): void;
  unmaximize(): void;
}): void {
  if (window.isFullScreen() || !window.isMaximizable()) return;
  if (window.isMaximized()) window.unmaximize();
  else window.maximize();
}
