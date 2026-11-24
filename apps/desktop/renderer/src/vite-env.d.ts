/// <reference types="vite/client" />

/** Electron 桌面壳通过 preload 注入的配置与系统能力；只在桌面渲染进程中使用。 */
interface Window {
  readonly archerDesktop?: {
    readonly apiUrl?: string;
    /** 稳定的服务导航标识，不使用本机服务的临时端口。 */
    readonly serviceKey?: string;
    /** Node 平台标识，例如 darwin、win32 */
    readonly platform?: string;
    readonly titlebarPointer?: (phase: 'start' | 'move' | 'end', x: number, y: number) => void;
    /** 切换当前窗口最大化和还原，全屏时不改变窗口状态。 */
    readonly toggleMaximize?: () => void;
    /** 打开系统目录选择器；取消时返回 null */
    readonly chooseDirectory?: () => Promise<string | null>;
    /** 查询或变更本机模型密钥，只返回状态，不向页面读取密钥。 */
    readonly hasModelKey?: (provider: string, address: string) => Promise<boolean>;
    readonly saveModelKey?: (provider: string, address: string, key: string | null) => Promise<void>;
    /** 同步应用主题到系统材质与标题栏按钮 */
    readonly setTheme?: (appearance: 'light' | 'dark' | 'system', colors: { color: string; symbolColor: string }) => void;
    /** 订阅原生菜单动作，返回取消订阅函数 */
    readonly onMenuAction?: (listener: (action: string) => void) => () => void;
  };
}
