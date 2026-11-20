/** 启动桌面应用；开发服务器与 Electron 共用生命周期，退出后释放端口。 */
import { spawn } from 'node:child_process';
import console from 'node:console';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { createServer } from 'vite';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(currentDir, '..');
const args = process.argv.slice(2);
let rendererServer;
let child;

try {
  // 自定义地址由调用者管理；默认开发入口由桌面命令启动，不再依赖另一应用。
  if (args.includes('--dev') && !process.env.ARCHER_DESKTOP_URL) {
    rendererServer = await createServer({ configFile: path.join(appRoot, 'vite.config.ts') });
    await rendererServer.listen();
  }
  child = spawn(electron, [appRoot, ...args], {
    // 独立进程组避免终端把退出信号同时送给后端；由 IPC 请求主进程正常退出。
    detached: true,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (child.connected) child.send({ type: 'archer.quit' });
      else child.kill(signal);
    });
  }
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  if (result.signal) console.error(`Electron 被信号终止：${result.signal}`);
  process.exitCode = result.code ?? 1;
} catch (error) {
  console.error('桌面应用启动失败：', error);
  process.exitCode = 1;
} finally {
  await rendererServer?.close();
}
