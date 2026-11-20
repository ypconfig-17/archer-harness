/** 桌面只管理 Server 子进程的生命周期；Agent 调度与日志仍由 Server 内的 Runtime 负责。 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

export interface BackendOptions {
  executable: string;
  entry: string;
  dataDir: string;
  env: NodeJS.ProcessEnv;
  onFailure(message: string): void;
}
export class DesktopBackend {
  readonly token = randomBytes(32).toString('hex');
  private child?: ChildProcess;
  private starting?: Promise<string>;
  private stopping?: Promise<void>;
  private closed = false;
  private diagnostics = '';

  constructor(private readonly options: BackendOptions) {}

  start(): Promise<string> {
    if (this.closed) return Promise.reject(new Error('Desktop backend is closed.'));
    if (this.starting) return this.starting;
    if (!existsSync(this.options.entry)) return Promise.reject(new Error('未找到 Server 构建产物，请先运行 pnpm build。'));
    mkdirSync(this.options.dataDir, { recursive: true });
    const child = spawn(this.options.executable, [this.options.entry], {
      cwd: this.options.dataDir,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { ...this.options.env, ELECTRON_RUN_AS_NODE: '1', HOST: '127.0.0.1', PORT: '0', HARNESS_TOKEN: this.token, HARNESS_DATA_DIR: this.options.dataDir },
      windowsHide: true,
    });
    this.child = child;
    child.stderr?.on('data', (chunk: Buffer) => { this.diagnostics = `${this.diagnostics}${chunk.toString()}`.slice(-8192).split(this.token).join('[已隐藏]'); });
    this.starting = new Promise<string>((resolve, reject) => {
      let ready = false;
      const timeout = setTimeout(() => {
        reject(new Error('本机服务未在启动期限内就绪。'));
        void this.stop();
      }, 30_000);
      child.on('message', value => {
        if (ready || this.closed || !value || typeof value !== 'object' || !('type' in value) || value.type !== 'archer.ready' || !('url' in value) || typeof value.url !== 'string') return;
        let url: URL;
        try { url = new URL(value.url); } catch { return; }
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) return;
        ready = true;
        clearTimeout(timeout);
        resolve(url.origin);
      });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', (code, signal) => {
        clearTimeout(timeout);
        const message = `本机服务已退出（${signal ?? code ?? 'unknown'}）。${this.diagnostics ? `\n${this.diagnostics}` : ''}`;
        if (!ready) reject(new Error(message));
        else if (!this.closed) this.options.onFailure(message);
      });
    });
    return this.starting;
  }

  /** 等待 Server 收敛执行；预算耗尽只结束进程，不伪造任何取消或写入结果。 */
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.closed = true;
    const child = this.child;
    if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    this.stopping = new Promise<void>(resolve => {
      const timeout = setTimeout(() => { child.kill('SIGKILL'); }, 20_000);
      child.once('exit', () => { clearTimeout(timeout); resolve(); });
      child.kill('SIGTERM');
    });
    return this.stopping;
  }
}
