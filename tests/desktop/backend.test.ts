/** 桌面拥有一个受鉴权保护的本机服务，启动和退出不得产生孤儿进程。 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { DesktopBackend } from '../../apps/desktop/src/backend';
const backends: DesktopBackend[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(backends.splice(0).map(backend => backend.stop()));
  await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
async function fixture(mode: string, onFailure: (message: string) => void = () => {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'archer-backend-test-'));
  dirs.push(dataDir);
  const backend = new DesktopBackend({ executable: process.execPath, entry: fileURLToPath(new URL('./fixtures/backend-child.mjs', import.meta.url)), dataDir, env: { ...process.env, ARCHER_BACKEND_TEST: mode, HOST: '0.0.0.0', PORT: '3000', HARNESS_TOKEN: 'old-token' }, onFailure });
  backends.push(backend);
  return backend;
}
it('同一次启动复用子进程，强制回环监听、临时端口和随机令牌，退出幂等', async () => {
  const backend = await fixture('normal');
  const first = backend.start();
  expect(backend.start()).toBe(first);
  expect(await first).toBe('http://127.0.0.1:12345');
  expect(backend.token).not.toBe('old-token');
  expect(backend.token).toHaveLength(64);
  await backend.stop();
  await backend.stop();
  await expect(backend.start()).rejects.toThrow('closed');
});
it('就绪前退出必须拒绝启动，而不是显示业务界面', async () => {
  const backend = await fixture('early-exit');
  await expect(backend.start()).rejects.toThrow('startup failure');
});
it('启动期间退出可以收敛等待中的子进程', async () => {
  const backend = await fixture('wait');
  const startup = backend.start();
  const stopped = backend.stop();
  await expect(startup).rejects.toThrow('本机服务已退出');
  await stopped;
});
it('运行中异常退出通知宿主，并移除诊断中的令牌', async () => {
  let failed!: (message: string) => void;
  const failure = new Promise<string>(resolve => { failed = resolve; });
  const backend = await fixture('late-exit', failed);
  await backend.start();
  const message = await failure;
  expect(message).toContain('[已隐藏]');
  expect(message).not.toContain(backend.token);
});
