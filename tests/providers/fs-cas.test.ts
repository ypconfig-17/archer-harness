/** 文件 CAS 以内容快照为依据，同进程受控访问跨工作环境与文件别名共享执行边界。 */
import { link, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FileWriteResult } from '@archer/contracts';
import { LocalFilesystem } from '@archer/providers';

const roots: string[] = [];
const signal = new AbortController().signal;

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'archer-fs-cas-'));
  roots.push(root);
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'note.txt'), 'original');
  return root;
}

function write(provider: LocalFilesystem, target: string, payload: string, expectedRevision?: string | null) {
  return provider.write(target, { content: payload, expectedRevision }, signal);
}

function expectOneWinner(results: readonly FileWriteResult[]): void {
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok).map((result) => result.error.code))
    .toEqual(Array(results.length - 1).fill('REVISION_CONFLICT'));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('文件 revision 与受控 CAS', () => {
  it('同长度且修改时间相同的外部内容变更仍使旧版本失效', async () => {
    const root = await workspace();
    const file = join(root, 'src', 'note.txt');
    await utimes(file, 1700000000, 1700000000);
    const provider = new LocalFilesystem(root);
    const target = 'src/note.txt';
    const before = await provider.inspect(target, signal);

    await writeFile(file, 'external');
    await utimes(file, 1700000000, 1700000000);
    const changed = await provider.inspect(target, signal);
    expect(changed.revision).not.toBe(before.revision);
    expect(await write(provider, target, 'stale write', before.revision))
      .toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
    expect(await readFile(file, 'utf8')).toBe('external');
  });

  it('同一 provider 并发消费同一个旧版本时，只有一个不同内容的更新成功', async () => {
    const provider = new LocalFilesystem(await workspace());
    const target = 'src/note.txt';
    const before = await provider.inspect(target, signal);
    const results = await Promise.all(Array.from({ length: 16 }, (_, index) =>
      write(provider, target, `updated-${index}`, before.revision)));
    expectOneWinner(results);
    const winner = results.findIndex((result) => result.ok);
    expect((await provider.inspect(target, signal)).content).toBe(`updated-${winner}`);
  });

  it.each(['same-root', 'nested-root', 'root-symlink', 'file-symlink', 'hardlink'] as const)(
    '不同 provider 的 %s 文件别名不能绕过受控 CAS', async (alias) => {
      const root = await workspace();
      const first = new LocalFilesystem(root);
      const firstTarget = 'src/note.txt';
      let secondRoot = root;
      let secondPath = 'src/note.txt';
      if (alias === 'nested-root') {
        secondRoot = join(root, 'src');
        secondPath = 'note.txt';
      } else if (alias === 'root-symlink') {
        const aliases = await mkdtemp(join(tmpdir(), 'archer-fs-alias-'));
        roots.push(aliases);
        secondRoot = join(aliases, 'workspace');
        await symlink(root, secondRoot, 'dir');
      } else if (alias === 'file-symlink' || alias === 'hardlink') {
        secondPath = 'src/alias.txt';
        const createAlias = alias === 'hardlink' ? link : symlink;
        await createAlias(join(root, 'src', 'note.txt'), join(root, secondPath));
      }
      const second = new LocalFilesystem(secondRoot);
      const secondTarget = secondPath;
      const before = await first.inspect(firstTarget, signal);
      expect((await second.inspect(secondTarget, signal)).revision).toBe(before.revision);

      const results = await Promise.all([
        write(first, firstTarget, 'first update', before.revision),
        write(second, secondTarget, 'second update', before.revision),
      ]);
      expectOneWinner(results);
      expect((await first.inspect(firstTarget, signal)).revision)
        .toBe((await second.inspect(secondTarget, signal)).revision);
    },
  );

  it('写入结果、另一实例的 stat 和重新接入后的读取使用同一个内容 revision', async () => {
    const root = await workspace();
    const target = 'src/note.txt';
    const provider = new LocalFilesystem(root);
    const before = await provider.inspect(target, signal);
    const result = await write(provider, target, 'updated', before.revision);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reattached = new LocalFilesystem(root);
    expect((await reattached.stat(target))?.revision).toBe(result.revisionAfter);
    expect((await reattached.inspect(target, signal)).revision).toBe(result.revisionAfter);
    expect(await write(reattached, target, 'next update', result.revisionAfter)).toMatchObject({ ok: true });
  });

  it('revision 标识内容而非写入次数或修改时间，同内容写入不消费版本', async () => {
    const root = await workspace();
    const provider = new LocalFilesystem(root);
    const target = 'src/note.txt';
    const before = await provider.inspect(target, signal);
    await utimes(join(root, target), 1700000100, 1700000100);
    expect((await provider.stat(target))?.revision).toBe(before.revision);
    expect(await write(provider, target, before.content, before.revision))
      .toMatchObject({ ok: true, revisionBefore: before.revision, revisionAfter: before.revision });
  });

  it('失败或已取消的访问不占住后续 provider 的执行边界', async () => {
    const root = await workspace();
    const first = new LocalFilesystem(root);
    const target = 'src/note.txt';
    await expect(first.inspect('src/missing.txt', signal)).rejects.toThrow();
    const cancelled = new AbortController();
    cancelled.abort();
    expect(await first.write(target, { content: 'cancelled' }, cancelled.signal))
      .toMatchObject({ ok: false });
    expect((await new LocalFilesystem(root).inspect(target, signal)).content).toBe('original');
  });

  it('create-only 并发只创建一次，并且不会覆盖获胜内容', async () => {
    const root = await workspace();
    const target = 'src/new.txt';
    const results = await Promise.all([
      write(new LocalFilesystem(root), target, 'first', null),
      write(new LocalFilesystem(root), target, 'second', null),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ error: { code: 'ALREADY_EXISTS' } });
    expect(await readFile(join(root, target), 'utf8'))
      .toBe(results[0]!.ok ? 'first' : 'second');
  });
});
