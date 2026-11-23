/** 桌面壳平台与快捷键文案；根据主进程注入的平台显示。 */

export function isMacDesktop(): boolean {
  return window.archerDesktop?.platform === 'darwin';
}

export function shortcutLabel(key: string): string {
  return isMacDesktop() ? `⌘${key}` : `Ctrl+${key}`;
}
