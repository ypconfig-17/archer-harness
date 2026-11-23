import { describe, expect, it } from 'vitest';
import { restoreWindowState, toggleWindowMaximize } from '../../apps/desktop/src/window-state';

const displays = [{ x: 0, y: 0, width: 1440, height: 900 }];
describe('桌面窗口恢复', () => {
  it('恢复正常窗口与最大化偏好', () => {
    const state = { bounds: { x: 50, y: 30, width: 1200, height: 800 }, maximized: true };
    expect(restoreWindowState(state, displays)).toEqual(state);
  });
  it('移除显示器或无效偏好时交回系统选择位置', () => {
    expect(restoreWindowState({ bounds: { x: 2000, y: 0, width: 1200, height: 800 } }, displays)).toBeUndefined();
    expect(restoreWindowState({ bounds: { x: 0, y: 0, width: 100, height: 100 } }, displays)).toBeUndefined();
    expect(restoreWindowState(null, displays)).toBeUndefined();
  });
  it('显示器缩小时限制窗口尺寸，避免延续超大窗口', () => {
    expect(restoreWindowState({ bounds: { x: 0, y: 0, width: 1900, height: 1200 } }, displays)?.bounds).toEqual({ x: 0, y: 0, width: 1440, height: 900 });
  });
});


it('顶部双击在最大化与还原之间切换，全屏和禁用窗口保持原状', () => {
  let maximized = false;
  let fullscreen = false;
  let allowed = true;
  const window = {
    isFullScreen: () => fullscreen,
    isMaximizable: () => allowed,
    isMaximized: () => maximized,
    maximize: () => { maximized = true; },
    unmaximize: () => { maximized = false; },
  };
  toggleWindowMaximize(window);
  expect(maximized).toBe(true);
  toggleWindowMaximize(window);
  expect(maximized).toBe(false);
  fullscreen = true;
  toggleWindowMaximize(window);
  expect(maximized).toBe(false);
  fullscreen = false;
  allowed = false;
  toggleWindowMaximize(window);
  expect(maximized).toBe(false);
});
