/** 工作区 Git 视图只读磁盘当前状态，并且只使用会话自己记录的工作区目录。 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ArcherClient } from '@archer/client';
import { createArcher } from '@archer/runtime';
import { testCamp } from '../helpers/application';
import { buildServer } from '../../apps/server/src/app';
import { parseGitStatus, readWorkspaceGitChanges } from '../../apps/server/src/workspace-git';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const hasGit = gitAvailable();

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'archer-git-'));
  roots.push(root);
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
  run('init', '-q');
  await writeFile(join(root, 'tracked.txt'), 'one\ntwo\n');
  await writeFile(join(root, 'old-name.txt'), 'moved\n');
  run('add', '.');
  run('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'init');
  return root;
}

it('解析 -z 状态并保留重命名原路径', () => {
  expect(parseGitStatus(' M src/a.ts\0?? new.txt\0R  b.txt\0a.txt\0')).toEqual([
    { index: ' ', worktree: 'M', path: 'src/a.ts' },
    { index: '?', worktree: '?', path: 'new.txt' },
    { index: 'R', worktree: ' ', path: 'b.txt', previousPath: 'a.txt' },
  ]);
});

describe.skipIf(!hasGit)('读取工作区 Git 差异', () => {
  it('区分暂存、未暂存、未跟踪与重命名', async () => {
    const root = await repository();
    await writeFile(join(root, 'tracked.txt'), 'one\nthree\n');
    await writeFile(join(root, 'new.txt'), 'hello\n');
    await writeFile(join(root, 'staged.txt'), 'staged\n');
    execFileSync('git', ['-C', root, 'add', 'staged.txt']);
    execFileSync('git', ['-C', root, 'mv', 'old-name.txt', 'new-name.txt']);

    const listing = await readWorkspaceGitChanges(root);
    const changes = listing.available ? { ...listing, files: await Promise.all(listing.files.map(async file => {
      const detail = await readWorkspaceGitChanges(root, 'all', file.path);
      return detail.available ? detail.files.find(item => item.path === file.path)! : file;
    })) } : listing;
    expect(changes.available).toBe(true);
    if (!changes.available) return;
    expect(changes.root).toBe(await realpath(root));
    expect(changes.omitted).toBe(0);

    const byPath = new Map(changes.files.map(file => [file.path, file]));
    expect(byPath.get('tracked.txt')).toMatchObject({
      status: 'modified',
      staged: false,
      workingTree: true,
      binary: false,
      truncated: false,
      before: 'one\ntwo\n',
      after: 'one\nthree\n',
    });
    // 未跟踪文件确认没有 HEAD 侧内容，不能把空字符串当成读取失败。
    expect(byPath.get('new.txt')).toMatchObject({
      status: 'untracked',
      before: '',
      after: 'hello\n',
    });
    expect(byPath.get('staged.txt')).toMatchObject({
      status: 'added',
      staged: true,
      workingTree: false,
      before: '',
      after: 'staged\n',
    });
    expect(byPath.get('new-name.txt')).toMatchObject({
      status: 'renamed',
      previousPath: 'old-name.txt',
      before: 'moved\n',
      after: 'moved\n',
    });
  });

  it('二进制文件只报告状态，不传内容', async () => {
    const root = await repository();
    await writeFile(join(root, 'blob.bin'), Buffer.from([0, 1, 2, 3]));
    const listing = await readWorkspaceGitChanges(root);
    const changes = listing.available ? { ...listing, files: await Promise.all(listing.files.map(async file => {
      const detail = await readWorkspaceGitChanges(root, 'all', file.path);
      return detail.available ? detail.files.find(item => item.path === file.path)! : file;
    })) } : listing;
    expect(changes.available).toBe(true);
    if (!changes.available) return;
    const file = changes.files.find(item => item.path === 'blob.bin');
    expect(file).toMatchObject({ status: 'untracked', binary: true, truncated: false });
    expect(file?.before).toBeUndefined();
    expect(file?.after).toBeUndefined();
  });
});

it('缺少工作区与不是仓库时返回可展示原因', async () => {
  expect(await readWorkspaceGitChanges(undefined)).toEqual({
    available: false,
    reason: 'no-workspace',
    detail: '会话没有记录工作区目录',
  });
  if (!hasGit) return;
  const root = await mkdtemp(join(tmpdir(), 'archer-plain-'));
  roots.push(root);
  const changes = await readWorkspaceGitChanges(root);
  expect(changes.available).toBe(false);
  if (changes.available) return;
  expect(changes.reason).toBe('not-a-repository');
});

it('HTTP 入口只按会话记录的工作区读取', async () => {
  const root = hasGit ? await repository() : undefined;
  if (root) await writeFile(join(root, 'tracked.txt'), 'changed\n');
  const archer = createArcher({ camp: testCamp() });
  await archer.start();
  const server = await buildServer({ archer, token: 'admin' });
  try {
    const address = await server.listen({ host: '127.0.0.1', port: 0 });
    const client = new ArcherClient({ baseUrl: address, token: 'admin' });
    const without = await client.create({ id: 'no-workspace', instructions: 'Answer.' });
    expect(await client.workspaceGitChanges(without.id)).toEqual({
      available: false,
      reason: 'no-workspace',
      detail: '会话没有记录工作区目录',
    });
    if (!root) return;
    const withWorkspace = await client.create({
      id: 'git-reader',
      instructions: 'Answer.',
      workspace: { cwd: root, access: 'read' },
    });
    const changes = await client.workspaceGitChanges(withWorkspace.id);
    expect(changes.available).toBe(true);
    if (!changes.available) return;
    expect(changes.files.map(file => file.path)).toContain('tracked.txt');
  } finally {
    server.server.closeAllConnections();
    await server.close();
    await archer.stop();
  }
});

it.skipIf(!hasGit)('列表不传原文，暂存和未暂存分别使用 Index 两侧', async () => {
  const root = await repository();
  await writeFile(join(root, 'tracked.txt'), 'staged\n');
  execFileSync('git', ['-C', root, 'add', 'tracked.txt']);
  await writeFile(join(root, 'tracked.txt'), 'working\n');
  const list = await readWorkspaceGitChanges(root);
  expect(list.available && list.files.every(file => file.before === undefined && file.after === undefined)).toBe(true);
  const staged = await readWorkspaceGitChanges(root, 'staged', 'tracked.txt');
  const unstaged = await readWorkspaceGitChanges(root, 'unstaged', 'tracked.txt');
  expect(staged.available && staged.files[0]).toMatchObject({ before: 'one\ntwo\n', after: 'staged\n' });
  expect(unstaged.available && unstaged.files[0]).toMatchObject({ before: 'staged\n', after: 'working\n' });
});
