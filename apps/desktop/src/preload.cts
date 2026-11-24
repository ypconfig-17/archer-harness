/**
 * Electron 桌面壳 preload：向页面暴露 API 地址、平台、系统目录选择与桌面菜单动作，不暴露 Node 能力。
 */

import { contextBridge, ipcRenderer } from 'electron';

const API_URL_ARGUMENT = '--archer-api-url=';
const MENU_ACTION_CHANNEL = 'archer:menu-action';
const THEME_CHANNEL = 'archer:theme';

contextBridge.exposeInMainWorld('archerDesktop', {
  apiUrl: process.argv.find((value) => value.startsWith(API_URL_ARGUMENT))?.slice(API_URL_ARGUMENT.length),
  serviceKey: process.argv.find(value => value.startsWith('--archer-service-key='))?.slice('--archer-service-key='.length),
  platform: process.platform,
  titlebarPointer: (phase: 'start' | 'move' | 'end', x: number, y: number): void => ipcRenderer.send('archer:titlebar-pointer', phase, x, y),
  toggleMaximize: (): void => ipcRenderer.send('archer:toggle-maximize'),
  chooseDirectory: (): Promise<string | null> => ipcRenderer.invoke('archer:choose-directory'),
  hasModelKey: (provider: string, address: string): Promise<boolean> => (
    ipcRenderer.invoke('archer:model-key-status', provider, address)
  ),
  saveModelKey: (provider: string, address: string, key: string | null): Promise<void> => (
    ipcRenderer.invoke('archer:save-model-key', provider, address, key)
  ),
  setTheme: (appearance: 'light' | 'dark' | 'system', colors: { color: string; symbolColor: string }): void => {
    ipcRenderer.send(THEME_CHANNEL, appearance, colors);
  },
  onMenuAction: (listener: (action: string) => void): (() => void) => {
    const handler = (_event: unknown, action: string): void => listener(action);
    ipcRenderer.on(MENU_ACTION_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(MENU_ACTION_CHANNEL, handler);
    };
  },
});
