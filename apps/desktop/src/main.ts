/**
 * Archer Harness — Electron 桌面壳
 *
 * 只负责窗口、桌面菜单、系统目录选择与主题同步；不重写内核规则、Turn 调度或 API。
 */

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  session,
  screen,
  shell,
  type MenuItemConstructorOptions,
} from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DesktopBackend } from './backend.js';
import { restoreWindowState, toggleWindowMaximize, type WindowState } from './window-state.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(currentDir, '../assets');
const rendererDist = path.resolve(currentDir, 'renderer');
const isDev = process.argv.includes('--dev');
const devUrl = process.env.ARCHER_DESKTOP_URL ?? 'http://127.0.0.1:5173';
let apiUrl = process.env.ARCHER_API_URL?.replace(/\/+$/, '') ?? '';
let token = process.env.ARCHER_TOKEN ?? process.env.HARNESS_TOKEN;
const CHOOSE_DIRECTORY_CHANNEL = 'archer:choose-directory';
const MENU_ACTION_CHANNEL = 'archer:menu-action';
const THEME_CHANNEL = 'archer:theme';
const WINDOWS_TITLEBAR_HEIGHT = 40;

type MenuAction = 'new-chat' | 'open-folder' | 'settings' | 'toggle-sidebar' | 'search-chats' | 'toggle-inspector';

let mainWindow: BrowserWindow | undefined;
let backend: DesktopBackend | undefined;
let quitting = false;
let reportingFailure = false;

async function reportFailure(message: string): Promise<void> {
  if (quitting || reportingFailure) return;
  reportingFailure = true;
  const result = await dialog.showMessageBox({ type: 'error', title: 'Archer 服务不可用', message: 'Archer 无法继续运行', detail: message.slice(-2000), buttons: ['重新启动应用', '退出'], defaultId: 0, cancelId: 1 });
  if (result.response === 0) app.relaunch();
  app.quit();
}

/** 顶部标题栏与侧栏共用同一底色，Windows 系统按钮才能融进桌面壳。 */
function chromeColors(): { color: string; symbolColor: string } {
  return nativeTheme.shouldUseDarkColors
    ? { color: '#12141A', symbolColor: '#E9ECF3' }
    : { color: '#F1F2F6', symbolColor: '#232736' };
}

function sendMenuAction(action: MenuAction): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(MENU_ACTION_CHANNEL, action);
}

/** 工作区目录由桌面进程调用系统选择器确定；取消时返回 null。 */
function registerDirectoryPicker(): void {
  let drag: { x: number; y: number; left: number; top: number } | undefined;
  // 只接受当前主窗口的有限坐标，拖拽状态不进入会话事实。
  ipcMain.on('archer:titlebar-pointer', (event, phase: unknown, x: unknown, y: unknown) => {
    const window = mainWindow;
    if (!window || window.isDestroyed() || event.sender !== window.webContents) return;
    if (phase === 'end') { drag = undefined; return; }
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (window.isFullScreen() || window.isMaximized()) return;
    if (phase === 'start') {
      const [left, top] = window.getPosition();
      drag = { x, y, left, top };
    } else if (phase === 'move' && drag) {
      window.setPosition(Math.round(drag.left + x - drag.x), Math.round(drag.top + y - drag.y));
    }
  });
  // 仅允许主窗口切换自身尺寸，渲染进程不能指定窗口或任意原生操作。
  ipcMain.on('archer:toggle-maximize', event => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
    toggleWindowMaximize(mainWindow);
  });
  ipcMain.handle(CHOOSE_DIRECTORY_CHANNEL, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;

    const result = await dialog.showOpenDialog(window, {
      title: '选择工作区目录',
      buttonLabel: '打开工作区',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
}

/** 页面主题跟随应用设置，系统材质与 Windows 标题栏按钮同步换色。 */
function registerThemeSync(): void {
  ipcMain.on(THEME_CHANNEL, (event, theme: unknown, palette: unknown) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
    if (theme !== 'light' && theme !== 'dark' && theme !== 'system') return;
    // 只接受当前窗口提供的两个不透明颜色，不允许渲染进程控制其他原生窗口选项。
    if (!palette || typeof palette !== 'object') return;
    const colors = palette as { color?: unknown; symbolColor?: unknown };
    const validColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
    if (!validColor(colors.color) || !validColor(colors.symbolColor)) return;
    nativeTheme.themeSource = theme;
    if (process.platform === 'win32') {
      mainWindow.setBackgroundColor(colors.color);
      mainWindow.setTitleBarOverlay({
        height: WINDOWS_TITLEBAR_HEIGHT,
        color: colors.color,
        symbolColor: colors.symbolColor,
      });
    }
  });
}

/** 令牌只进入主进程，由会话层附加到发往 Server 的请求。 */
function configureApiSession(): void {
  if (!token) return;

  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [`${apiUrl}/api/*`] },
    (details, callback) => {
      details.requestHeaders.Authorization = `Bearer ${token}`;
      callback({ requestHeaders: details.requestHeaders });
    },
  );
}

function openExternal(url: string): void {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    void shell.openExternal(url);
  }
}

function installContextMenu(window: BrowserWindow): void {
  window.webContents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      items.push(
        { role: 'undo', label: '撤销', enabled: params.editFlags.canUndo },
        { role: 'redo', label: '重做', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', label: '剪切', enabled: params.editFlags.canCut },
        { role: 'copy', label: '复制', enabled: params.editFlags.canCopy },
        { role: 'paste', label: '粘贴', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', label: '全选', enabled: params.editFlags.canSelectAll },
      );
    } else if (params.selectionText.length > 0) {
      items.push({ role: 'copy', label: '复制', enabled: params.editFlags.canCopy });
    }
    if (items.length === 0) return;
    Menu.buildFromTemplate(items.map(item => ({ ...item, accelerator: '' }))).popup({ window });
  });
}

/** 原生菜单是桌面入口：快捷键与菜单项都只向页面发送动作，不重复实现界面逻辑。 */
function installApplicationMenu(): void {
  const darwin = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(darwin ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const, label: '关于 Archer' },
        { type: 'separator' as const },
        { label: '设置…', accelerator: 'Cmd+,', click: () => sendMenuAction('settings') },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const, label: '隐藏 Archer' },
        { role: 'hideOthers' as const, label: '隐藏其他' },
        { role: 'unhide' as const, label: '全部显示' },
        { type: 'separator' as const },
        { role: 'quit' as const, label: '退出 Archer' },
      ],
    }] : []),
    {
      label: '文件',
      submenu: [
        { label: '新建对话', accelerator: 'CmdOrCtrl+N', click: () => sendMenuAction('new-chat') },
        { label: '打开文件夹…', accelerator: 'CmdOrCtrl+O', click: () => sendMenuAction('open-folder') },
        { type: 'separator' },
        ...(darwin
          ? [{ role: 'close' as const, label: '关闭窗口' }]
          : [{ role: 'quit' as const, label: '退出 Archer' }]),
      ],
    },
    { role: 'editMenu', label: '编辑' },
    {
      label: '显示',
      submenu: [
        { label: '搜索对话', accelerator: 'CmdOrCtrl+K', click: () => sendMenuAction('search-chats') },
        { label: '切换工作台', accelerator: 'CmdOrCtrl+Shift+I', click: () => sendMenuAction('toggle-inspector') },
        { label: '切换侧栏', accelerator: 'CmdOrCtrl+B', click: () => sendMenuAction('toggle-sidebar') },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        ...(isDev
          ? [{ type: 'separator' as const }, { role: 'reload' as const, label: '重新加载' }, { role: 'toggleDevTools' as const, label: '开发者工具' }]
          : []),
      ],
    },
    { role: 'windowMenu', label: '窗口' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): void {
  const darwin = process.platform === 'darwin';
  const win32 = process.platform === 'win32';
  const colors = chromeColors();

  const statePath = path.join(app.getPath('userData'), 'window-state.json');
  let saved: WindowState | undefined;
  try {
    saved = restoreWindowState(JSON.parse(readFileSync(statePath, 'utf8')), screen.getAllDisplays().map(display => display.workArea));
  } catch {
    // 缺失或损坏的偏好不影响桌面启动。
  }
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Archer',
    zoomToPageWidth: false,
    // macOS 由 Dock 图标决定外观，其余平台使用窗口图标。
    icon: path.join(assetsDir, process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    ...saved?.bounds,
    ...(darwin ? {
      // 红绿灯嵌进侧栏，侧栏材质需要透明页面才能透出系统毛玻璃。
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 16, y: 18 },
      vibrancy: 'sidebar' as const,
      visualEffectState: 'active' as const,
      backgroundColor: '#00000000',
    } : {}),
    ...(win32 ? {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: {
        height: WINDOWS_TITLEBAR_HEIGHT,
        color: colors.color,
        symbolColor: colors.symbolColor,
      },
      autoHideMenuBar: true,
      backgroundColor: colors.color,
    } : {}),
    webPreferences: {
      preload: path.join(currentDir, 'preload.cjs'),
      additionalArguments: [`--archer-api-url=${apiUrl}`, `--archer-service-key=${backend ? 'desktop-local' : apiUrl}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (saved?.maximized) window.maximize();
  window.on('close', () => {
    try {
      writeFileSync(statePath, JSON.stringify({ bounds: window.getNormalBounds(), maximized: window.isMaximized() }));
    } catch {
      // 无法保存窗口偏好时仍允许正常关闭。
    }
  });
  mainWindow = window;
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined;
  });

  installContextMenu(window);

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  // 页面内的普通链接也不允许把桌面窗口导航到外部地址。
  window.webContents.on('will-navigate', (event, url) => {
    if (url === window.webContents.getURL()) return;
    event.preventDefault();
    openExternal(url);
  });

  window.webContents.on('render-process-gone', (_event, details) => { void reportFailure(`界面进程已退出：${details.reason}`); });

  if (isDev) {
    void window.loadURL(devUrl).catch(error => reportFailure(String(error)));
    return;
  }

  const entry = path.join(rendererDist, 'index.html');
  if (!existsSync(entry)) {
    dialog.showErrorBox(
      'Archer 桌面壳',
      `未找到桌面界面构建产物：${entry}\n请先在仓库根目录运行 pnpm build。`,
    );
    app.quit();
    return;
  }

  void window.loadFile(entry).catch(error => reportFailure(String(error)));
}

app.setName('Archer');

if (!app.requestSingleInstanceLock()) app.quit();
else void app.whenReady().then(async () => {
  // 开发态未打包，需要显式设置 Dock 图标，否则沿用 Electron 默认图标。
  if (process.platform === 'darwin') app.dock?.setIcon(path.join(assetsDir, 'icon.png'));
  if (!apiUrl) {
    backend = new DesktopBackend({
      executable: process.execPath,
      entry: path.resolve(currentDir, '../../server/dist/index.js'),
      dataDir: process.env.HARNESS_DATA_DIR ? path.resolve(process.env.HARNESS_DATA_DIR) : path.join(app.getPath('userData'), 'harness'),
      env: { ...process.env, ...(process.env.HARNESS_AI_CONFIG ? { HARNESS_AI_CONFIG: path.resolve(process.env.HARNESS_AI_CONFIG) } : {}) },
      onFailure: message => { void reportFailure(message); },
    });
    apiUrl = await backend.start();
    token = backend.token;
  }
  configureApiSession();
  registerDirectoryPicker();
  registerThemeSync();
  installApplicationMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch(error => reportFailure(String(error)));

app.on('second-instance', () => {
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show();
  mainWindow?.focus();
});
// 启动器将终端退出转换为 IPC，避免信号越过应用生命周期直接终止 Journal 写入。
process.on('message', message => {
  if (message && typeof message === 'object' && 'type' in message && message.type === 'archer.quit') app.quit();
});
process.once('disconnect', () => app.quit());

app.on('before-quit', event => {
  if (quitting || !backend) return;
  event.preventDefault();
  quitting = true;
  void backend.stop().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
