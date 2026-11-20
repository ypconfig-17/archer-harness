/** 固定项目参考遵守工作目录、体积与取消边界。 */
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createCamp, INFERENCE_PREPARE } from '@archer/camp';
import { projectContextProvider, workspaceFiles } from '@archer/providers';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'archer-project-reference-')); cleanups.push(() => rm(root, { recursive: true, force: true }));
  const camp = await createCamp({ providers: [projectContextProvider()] }); cleanups.push(() => camp.close());
  const capability = camp.resolve(camp.list(INFERENCE_PREPARE)[0]!.ref, INFERENCE_PREPARE);
  const workspace = { cwd: root, access: 'read' as const };
  const prepare = (signal = camp.signal) => capability.prepare({}, { signal, workspace, files: workspaceFiles(workspace, signal) });
  return { root, prepare, capability, camp };
}
it('只加载根约定、README 与包信息，不执行项目脚本或读取源码树', async () => {
  const f = await fixture(); await writeFile(join(f.root, 'AGENTS.md'), 'Run targeted tests.'); await writeFile(join(f.root, 'README.md'), 'Project architecture.');
  await writeFile(join(f.root, 'package.json'), '{"scripts":{"prepare":"touch should-not-exist"}}'); await mkdir(join(f.root, 'src')); await writeFile(join(f.root, 'src/secret.ts'), 'DO NOT AUTOLOAD');
  const result = await f.prepare() as any;
  expect(result.files.map((file: any) => file.path)).toEqual(['AGENTS.md', 'README.md', 'package.json']);
  expect(result.files.every((file: any) => typeof file.revision === 'string')).toBe(true);
  expect(result.entries.some((entry: any) => entry.name === 'src')).toBe(true);
  expect(JSON.stringify(result)).not.toContain('DO NOT AUTOLOAD'); expect(result.entries.some((entry: any) => entry.name === 'should-not-exist')).toBe(false);
});
it('大文件和大根目录明确标注省略，序列化结果控制在 56 KiB', async () => {
  const f = await fixture();
  await writeFile(join(f.root, 'AGENTS.md'), '\u0001😀'.repeat(8_000));
  for (let index = 0; index < 80; index++) await writeFile(join(f.root, `file-${index}.txt`), '');
  const result = await f.prepare() as any;
  expect(result.files[0].truncated).toBe(true); expect(result.entriesOmitted).toBeGreaterThan(0);
  expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(57_344);
  expect(Buffer.from(result.files[0].content).toString()).toBe(result.files[0].content);
});
it('根约定在单文档预算内保持全文', async () => {
  const f = await fixture();
  const guidance = 'a'.repeat(15_000);
  await writeFile(join(f.root, 'AGENTS.md'), guidance);
  const result = await f.prepare() as any;
  expect(result.files[0]).toMatchObject({ path: 'AGENTS.md', truncated: false, content: guidance });
});
it('缺少工作环境明确返回空参考，符号链接不能读取外部约定', async () => {
  const f = await fixture(); expect(await f.capability.prepare({}, { signal: f.camp.signal })).toMatchObject({ status: 'no-workspace', files: [] });
  const external = await mkdtemp(join(tmpdir(), 'archer-external-guidance-')); cleanups.push(() => rm(external, { recursive: true, force: true }));
  await writeFile(join(external, 'AGENTS.md'), 'PRIVATE EXTERNAL'); await symlink(join(external, 'AGENTS.md'), join(f.root, 'AGENTS.md'));
  const result = await f.prepare() as any; expect(result.files).toEqual([]); expect(JSON.stringify(result)).not.toContain('PRIVATE EXTERNAL');
  await expect(f.prepare(AbortSignal.abort(new Error('Cancelled')))).rejects.toThrow('Cancelled');
});
