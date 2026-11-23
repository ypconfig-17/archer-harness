/**
 * 本地工作环境的端到端测试：嵌套路径、CAS、目录写入与 symlink 逃逸。
 */

import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { workspaceFiles } from '@archer/providers';

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'archer-files-fs-'));
  tempDirs.push(dir);
  await mkdir(join(dir, 'src'));
  await writeFile(join(dir, 'README.md'), '# 示例\n', 'utf-8');
  await writeFile(join(dir, 'src', 'index.ts'), 'export const x = 1;\n', 'utf-8');
  return dir;
}

function createFiles(root: string) {
  return workspaceFiles({ cwd: root, access: 'edit' }, signal);
}

const signal = new AbortController().signal;

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('工作环境文件端口', () => {
  it('可以读取工作目录下的嵌套文件', async () => {
    const root = await makeWorkspace();
    const files = createFiles(root);

    const result = await files.inspect('src/index.ts');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content).toBe('export const x = 1;\n');
      expect(result.value.revision).toMatch(/^fs:/);
    }
  });

  it('通过子路径创建文件并做 CAS', async () => {
    const root = await makeWorkspace();
    const files = createFiles(root);

    const created = await files.write('notes.md', 'hello');
    expect(created.ok).toBe(true);
    if (!created.ok || !created.value.ok) return;
    const revision = created.value.revisionAfter;
    expect(await readFile(join(root, 'notes.md'), 'utf-8')).toBe('hello');

    const conflict = await files.write('notes.md', 'nope', 'wrong');
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.code).toBe('REVISION_CONFLICT');

    const updated = await files.write('notes.md', 'world', revision);
    expect(updated.ok).toBe(true);
    if (updated.ok && updated.value.ok) {
      expect(updated.value.revisionAfter).not.toBe(revision);
    }
    expect(await readFile(join(root, 'notes.md'), 'utf-8')).toBe('world');
  });

  it('拒绝写入目录', async () => {
    const root = await makeWorkspace();
    const files = createFiles(root);

    const result = await files.write('.', 'nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_A_FILE');
  });

  it('拒绝路径穿越', async () => {
    const root = await makeWorkspace();
    const files = createFiles(root);

    const result = await files.write('../escape.txt', 'nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(['PROVIDER_ERROR', 'PATH_INVALID']).toContain(result.error.code);
  });

  it('拒绝经 symlink 逃出工作根', async () => {
    const root = await makeWorkspace();
    const outsideDir = await mkdtemp(join(tmpdir(), 'archer-files-outside-'));
    tempDirs.push(outsideDir);
    const outside = join(outsideDir, 'secret.txt');
    await writeFile(outside, 'secret', 'utf-8');

    try {
      await symlink(outside, join(root, 'link.txt'));
    } catch {
      return;
    }

    const files = createFiles(root);
    const result = await files.inspect('link.txt');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROVIDER_ERROR');
  });

  it('接受工作目录内的宿主绝对路径，拒绝外部绝对路径', async () => {
    const root = await makeWorkspace();
    const files = createFiles(root);
    const result = await files.inspect(join(root, 'README.md'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.content).toBe('# 示例\n');
    expect((await files.inspect('/etc/passwd')).ok).toBe(false);
    expect((await files.list('/')).ok).toBe(false);
  });

  it('目录列表只返回直接子项，不把宿主目录发布为能力树', async () => {
    const root = await makeWorkspace();
    const files = createFiles(root);
    const result = await files.list('src');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map(entry => entry.name)).toEqual(['index.ts']);
    expect(JSON.stringify(result)).not.toContain(await realpath(root));
  });
});
