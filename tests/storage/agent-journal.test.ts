/** 日志优化只能复用已验证事实，不能把外部变更或不确定提交当成正常追加。 */
import { mkdtemp, readFile, writeFile, appendFile, truncate, rename, rm, unlink, utimes, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fork } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentEventSchema, type AgentDraft } from '@archer/contracts';
import { JsonlAgentJournal } from '@archer/storage';

const fault = vi.hoisted(() => ({
  bytes: 0,
  sync: '' as '' | 'file' | 'directory',
  partial: false,
  close: false,
  readHook: undefined as undefined | (() => Promise<void>),
  writeHook: undefined as undefined | (() => Promise<void>),
  unlock: false,
}));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, unlink: async (...args: Parameters<typeof actual.unlink>) => {
    if (fault.unlock && String(args[0]).endsWith('.lock')) throw new Error('unlock failed');
    return actual.unlink(...args);
  }, open: async (...args: Parameters<typeof actual.open>) => {
    const handle = await actual.open(...args);
    const file = String(args[0]);
    const log = file.endsWith('.jsonl');
    if (log) {
      const read = handle.readFile.bind(handle);
      handle.readFile = async () => {
        const buffer = await read();
        fault.bytes += buffer.length;
        await fault.readHook?.();
        return buffer;
      };
      const write = handle.writeFile.bind(handle);
      handle.writeFile = async data => {
        if (fault.partial) {
          const bytes = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
          await handle.write(bytes.subarray(0, Math.floor(bytes.length / 2)));
          throw new Error('partial write');
        }
        await write(data);
        await fault.writeHook?.();
      };
      const close = handle.close.bind(handle);
      handle.close = async () => {
        await close();
        if (fault.close) throw new Error('close confirmation lost');
      };
    }
    const sync = handle.sync.bind(handle);
    handle.sync = async () => {
      await sync();
      if (fault.sync === (log ? 'file' : 'directory') && !file.endsWith('.lock')) {
        throw new Error('sync confirmation lost');
      }
    };
    return handle;
  } };
});

const directories: string[] = [];
afterEach(async () => {
  Object.assign(fault, { bytes: 0, sync: '', partial: false, close: false, readHook: undefined, writeHook: undefined, unlock: false });
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'archer-journal-'));
  directories.push(directory);
  return { directory, file: join(directory, 'a.jsonl'), journal: new JsonlAgentJournal(directory) };
}
const draft = (title = 'first'): AgentDraft => ({ scope: 'agent', event: { type: 'agent.renamed', data: { title, renamedAt: 100 } } });
const turnDraft = (turnId: string): AgentDraft => ({ scope: 'turn', turnId, event: { type: 'turn.completed', data: { completedAt: 100, stopReason: 'respond' } } });
const append = (journal: JsonlAgentJournal, expectedSeq: number, drafts: AgentDraft[] = [draft()]) => journal.append({ agentId: 'a', expectedSeq, drafts });

it('正常追加只读一次文件，不重复校验已确认历史，恢复仍完整校验', async () => {
  const { journal, file } = await setup();
  await append(journal, 0, [turnDraft('t1'), turnDraft('t2')]);
  const bytes = (await stat(file)).size;
  const validate = vi.spyOn(AgentEventSchema, 'safeParse');
  fault.bytes = 0;
  const added = await append(journal, 2, [turnDraft('t1')]);
  expect(fault.bytes).toBe(bytes);
  expect(validate).toHaveBeenCalledTimes(1);
  expect(added[0]).toMatchObject({ seq: 3, fact: { turnSeq: 2 } });
  validate.mockClear();
  expect(await journal.read('a')).toHaveLength(3);
  expect(validate).toHaveBeenCalledTimes(3);
});

it('冲突不推进序号；同实例并发追加仍串行比较 CAS', async () => {
  const { journal } = await setup();
  const results = await Promise.allSettled([append(journal, 0), append(journal, 0)]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'CONFLICT' } });
  expect((await append(journal, 1))[0]!.seq).toBe(2);
});

it('另一实例顺序追加后验证新增批次，并保持 Agent 和 Turn CAS', async () => {
  const { journal, directory } = await setup();
  await append(journal, 0, [turnDraft('t1')]);
  await append(new JsonlAgentJournal(directory), 1, [turnDraft('t1')]);
  await expect(append(journal, 1)).rejects.toMatchObject({ code: 'CONFLICT' });
  const added = await append(journal, 2, [turnDraft('t1')]);
  expect(added[0]).toMatchObject({ seq: 3, fact: { turnSeq: 3 } });
});

it('同尺寸历史改写且恢复 mtime 后仍隔离，不能在当前实例绕过缓存重新提交', async () => {
  const { journal, file } = await setup();
  await append(journal, 0);
  const before = await stat(file);
  const raw = await readFile(file, 'utf8');
  await writeFile(file, raw.replace('first', 'other'));
  await utimes(file, before.atime, before.mtime);
  await expect(append(journal, 1)).rejects.toMatchObject({ code: 'EVENT_LOG_CORRUPT' });
  await expect(append(journal, 1)).rejects.toMatchObject({ code: 'EVENT_LOG_CORRUPT' });
  expect((await readFile(file, 'utf8')).split('\n')).toHaveLength(2);
});

it.each(['truncate', 'replace'] as const)('检测已确认文件的 %s，不沿用尾部缓存', async mode => {
  const { journal, file } = await setup();
  await append(journal, 0);
  if (mode === 'truncate') await truncate(file, 0);
  else {
    const replacement = `${file}.replacement`;
    await writeFile(replacement, await readFile(file));
    await rename(replacement, file);
  }
  await expect(append(journal, 1)).rejects.toMatchObject({ code: 'EVENT_LOG_CORRUPT' });
});

it('只修复未完成尾行，完整历史损坏时不会先截断文件', async () => {
  const { journal, directory, file } = await setup();
  await append(journal, 0);
  await appendFile(file, '[{"partial":');
  expect(await journal.read('a')).toHaveLength(1);
  expect((await append(journal, 1))[0]!.seq).toBe(2);
  const damaged = `${(await readFile(file, 'utf8')).replace('"seq":1', '"seq":9')}[partial`;
  await writeFile(file, damaged);
  await expect(append(new JsonlAgentJournal(directory), 2)).rejects.toMatchObject({ code: 'EVENT_LOG_CORRUPT' });
  expect(await readFile(file, 'utf8')).toBe(damaged);
});

it.each(['agent-seq', 'turn-seq', 'timestamp', 'schema'] as const)('恢复始终拒绝 %s 损坏', async mode => {
  const { journal, file, directory } = await setup();
  await append(journal, 0, [turnDraft('t1'), turnDraft('t1')]);
  const batch = JSON.parse((await readFile(file, 'utf8')).trim());
  if (mode === 'agent-seq') batch[1].seq = 9;
  if (mode === 'turn-seq') batch[1].fact.turnSeq = 9;
  if (mode === 'timestamp') batch[1].ts = 0;
  if (mode === 'schema') delete batch[1].fact.event.data;
  await writeFile(file, `${JSON.stringify(batch)}\n`);
  await expect(new JsonlAgentJournal(directory).read('a', 100)).rejects.toMatchObject({ code: 'EVENT_LOG_CORRUPT' });
});

it('增量完整批次损坏时保留原文件，并报告实际日志行号', async () => {
  const { journal, file } = await setup();
  await append(journal, 0);
  await append(journal, 1);
  await appendFile(file, '{invalid}\n[partial');
  const original = await readFile(file);
  await expect(append(journal, 2)).rejects.toMatchObject({
    code: 'EVENT_LOG_CORRUPT', message: expect.stringContaining('第 3 行'),
  });
  expect(await readFile(file)).toEqual(original);
});

it('读取期间发生变化时拒绝提交，不产生新批次', async () => {
  const { journal, file } = await setup();
  await append(journal, 0);
  fault.readHook = () => appendFile(file, 'external');
  await expect(append(journal, 1)).rejects.toMatchObject({ code: 'EVENT_LOG_CORRUPT' });
  fault.readHook = undefined;
  expect(await journal.read('a')).toHaveLength(1);
});

it.each(['file', 'directory', 'partial', 'close'] as const)('%s 确认失败后冻结缓存和写入，重开也不能自动抢占遗留锁', async mode => {
  const { journal, file, directory } = await setup();
  await append(journal, 0);
  if (mode === 'file' || mode === 'directory') fault.sync = mode;
  else fault[mode] = true;
  await expect(append(journal, 1)).rejects.toMatchObject({ code: 'COMMIT_UNKNOWN' });
  Object.assign(fault, { sync: '', partial: false, close: false });
  await expect(append(journal, 1)).rejects.toMatchObject({ code: 'COMMIT_UNKNOWN' });
  const reopened = new JsonlAgentJournal(directory);
  const recovered = await reopened.read('a');
  expect(recovered).toHaveLength(mode === 'partial' ? 1 : 2);
  await expect(append(reopened, recovered.length)).rejects.toMatchObject({ code: 'CONFLICT' });
  // 测试充当运维方：所有写入已结束，完整恢复后才显式移除遗留锁。
  await unlink(`${file}.lock`);
  expect((await append(reopened, recovered.length))[0]!.seq).toBe(recovered.length + 1);
});

it('解锁失败不能发布成功或推进已确认状态', async () => {
  const { journal, directory, file } = await setup();
  await append(journal, 0);
  fault.unlock = true;
  await expect(append(journal, 1)).rejects.toMatchObject({ code: 'COMMIT_UNKNOWN' });
  fault.unlock = false;
  expect(await new JsonlAgentJournal(directory).read('a')).toHaveLength(2);
  await expect(append(journal, 2)).rejects.toMatchObject({ code: 'COMMIT_UNKNOWN' });
  await unlink(`${file}.lock`);
  expect((await append(new JsonlAgentJournal(directory), 2))[0]!.seq).toBe(3);
});

it('写入期间文件替换视为未知提交，不向替换文件补写', async () => {
  const { journal, file } = await setup();
  await append(journal, 0);
  const original = await readFile(file);
  fault.writeHook = async () => {
    await writeFile(`${file}.new`, original);
    await rename(`${file}.new`, file);
  };
  await expect(append(journal, 1)).rejects.toMatchObject({ code: 'COMMIT_UNKNOWN' });
  fault.writeHook = undefined;
  expect(await readFile(file)).toEqual(original);
  await expect(append(journal, 1)).rejects.toMatchObject({ code: 'COMMIT_UNKNOWN' });
});

it('提交锁被替换后拒绝写入，也不会删除其他持有者的锁', async () => {
  const { journal, file } = await setup();
  await append(journal, 0);
  fault.readHook = async () => {
    await unlink(`${file}.lock`);
    await writeFile(`${file}.lock`, 'foreign-owner');
  };
  await expect(append(journal, 1)).rejects.toMatchObject({ code: 'EVENT_LOG_CORRUPT' });
  fault.readHook = undefined;
  expect(await readFile(`${file}.lock`, 'utf8')).toBe('foreign-owner');
  expect(await journal.read('a')).toHaveLength(1);
});

it('多字节正文的未完成尾行按字节边界修复，不损伤完整批次', async () => {
  const { journal, file } = await setup();
  await append(journal, 0, [draft('中文标题')]);
  await appendFile(file, Buffer.from('["未完成'));
  await append(journal, 1, [draft('下一条')]);
  expect((await journal.read('a')).map(event => event.fact.event.type)).toEqual(['agent.renamed', 'agent.renamed']);
  expect(await readFile(file, 'utf8')).toContain('中文标题');
});

it('非法草稿在修复尾行之前拒绝，后续合法提交不受影响', async () => {
  const { journal, file } = await setup();
  await append(journal, 0);
  await appendFile(file, '[partial');
  const before = await readFile(file);
  await expect(append(journal, 1, [draft('')])).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  expect(await readFile(file)).toEqual(before);
  expect((await append(journal, 1))[0]!.seq).toBe(2);
});

describe('跨进程提交锁', () => {
  it('阻止同时写入；原持有者提交完成后重新检查 CAS', async () => {
    const { journal, directory } = await setup();
    await append(journal, 0);
    const child = fork(new URL('./fixtures/journal-writer.mjs', import.meta.url), [directory, 'pause'], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    try {
      await Promise.race([
        once(child, 'message'),
        once(child, 'exit').then(([code]) => { throw new Error(`writer exited before lock: ${code}`); }),
      ]);
      await expect(append(journal, 1)).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'journal_writer_lock' } });
      const exited = once(child, 'exit');
      child.send('continue');
      expect((await exited)[0]).toBe(0);
      await expect(append(journal, 1)).rejects.toMatchObject({ code: 'CONFLICT', details: { actualSeq: 2 } });
      expect((await append(journal, 2))[0]!.seq).toBe(3);
    } finally {
      if (child.exitCode === null) child.kill();
    }
  });

  it('异常退出留下部分尾行和锁；恢复验证不把部分写入当成成功', async () => {
    const { journal, directory, file } = await setup();
    await append(journal, 0);
    const child = fork(new URL('./fixtures/journal-writer.mjs', import.meta.url), [directory, 'crash'], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    expect((await once(child, 'exit'))[0]).toBe(23);
    const reopened = new JsonlAgentJournal(directory);
    expect(await reopened.read('a')).toHaveLength(1);
    await expect(append(reopened, 1)).rejects.toMatchObject({ code: 'CONFLICT' });
    await unlink(`${file}.lock`);
    expect((await append(reopened, 1))[0]!.seq).toBe(2);
  });
});
