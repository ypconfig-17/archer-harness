/** Shell 工具提供 invoke，执行边界、退出结果与环境变量仍明确。 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShellProvider, shellProvider } from '@archer/providers';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'archer-shell-'));
  directories.push(root);
  const contribution = shellProvider().capabilities.bash!;
  return { root, description: contribution.metadata.description, inputSchema: contribution.metadata.inputSchema,
    invoke: (input: unknown, signal = new AbortController().signal) => contribution.implementation.invoke(input, { signal, workspace: { cwd: root, access: 'edit' } }) };

}
describe('Shell 工具', () => {
  it('契约说明初始 cwd 不是沙箱，并公开实际参数', async () => {
    const node = await (await fixture());
    expect(node.description).toContain('not filesystem or network isolation');
    expect(node.inputSchema).toMatchObject({ required: ['command'], properties: { cwd: { type: 'string' } } });
  });
  it('执行命令并返回输出', async () => {
    expect(await (await fixture()).invoke({ command: 'printf hello' })).toMatchObject({ output: expect.stringContaining('hello') });
  });
  it('非零退出保留真实 stdout/stderr 和退出码', async () => {
    expect(await (await fixture()).invoke({ command: 'printf out; printf err >&2; exit 7' })).toMatchObject({ metadata: { command: { stdout: 'out', stderr: 'err', exitCode: 7 } } });
  });
  it('初始 cwd 不能越出工作目录边界', async () => {
    await expect((await fixture()).invoke({ command: 'pwd', cwd: '..' })).rejects.toMatchObject({ code: 'PATH_INVALID' });
  });
  it('继承宿主 HOME 和自定义环境，能从工作区外的 HOME 读取配置', async () => {
    const home = await mkdtemp(join(tmpdir(), 'archer-home-'));
    directories.push(home);
    await writeFile(join(home, 'config'), 'host-config');
    vi.stubEnv('HOME', home);
    vi.stubEnv('ARCHER_SHELL_ENV_TEST', 'host-value');
    try {
      expect(await (await fixture()).invoke({ command: 'printf "%s\\n" "$HOME" "$ARCHER_SHELL_ENV_TEST"; cat "$HOME/config"' })).toMatchObject({
        metadata: { command: { stdout: `${home}\nhost-value\nhost-config`, exitCode: 0 } },
      });
    } finally { vi.unstubAllEnvs(); }
  });
  it('显式环境覆盖优先于宿主环境', async () => {
    const node = await fixture();
    const provider = new ShellProvider(node.root, { env: { HOME: '/explicit-home', ARCHER_SHELL_ENV_TEST: 'override' } });
    expect(await provider.execute({ command: 'printf "%s\\n" "$HOME" "$ARCHER_SHELL_ENV_TEST"' }, new AbortController().signal)).toMatchObject({
      metadata: { command: { stdout: '/explicit-home\noverride\n', exitCode: 0 } },
    });
  });
  it('取消信号在执行前拒绝命令', async () => {
    await expect((await fixture()).invoke({ command: 'printf nope' }, AbortSignal.abort())).rejects.toThrow('cancelled');
  });
});
