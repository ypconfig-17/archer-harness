import { testCamp } from '../helpers/application';
import { toolReply } from '../helpers/inference';
/** 真实文件写入的故障注入：按调用边界区分确定拒绝与未知副作用，恢复不重放写入。 */
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent, AgentEvent, Archer, AgentJournal, Snapshot, TurnEvent } from '@archer/contracts';
import { ArcherError } from '@archer/contracts';
import { createArcher } from '@archer/runtime';
import { JsonlAgentJournal } from '@archer/storage';
import { LocalFilesystem } from '@archer/providers';

type Fault = 'none' | 'after-write' | 'partial-write' | 'readback-stat' | 'readback-missing'
  | 'readback-eexist' | 'readback-revision' | 'readback-realpath' | 'before-write' | 'exclusive-race';
const injection = vi.hoisted(() => ({
  target: '', mode: 'none' as Fault, writes: 0,
  afterWrite: undefined as undefined | (() => Promise<void>),
  onStat: undefined as undefined | (() => void),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const fault = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`Injected ${code}`), { code });
  return {
    ...actual,
    stat: async (...args: Parameters<typeof actual.stat>) => {
      if (String(args[0]) === injection.target) {
        if (injection.mode === 'before-write') throw fault('EACCES');
        if (injection.writes > 0) {
          if (injection.mode === 'readback-stat') throw fault('EIO');
          if (injection.mode === 'readback-missing') throw fault('ENOENT');
          if (injection.mode === 'readback-eexist') throw fault('EEXIST');
        }
      }
      const result = await actual.stat(...args);
      if (String(args[0]) === injection.target) injection.onStat?.();
      return result;
    },
    realpath: async (...args: Parameters<typeof actual.realpath>) => {
      if (String(args[0]) === injection.target && injection.writes > 0 && injection.mode === 'readback-realpath') throw fault('EACCES');
      return actual.realpath(...args);
    },
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (String(args[0]) !== injection.target) return actual.writeFile(...args);
      injection.writes += 1;
      if (injection.mode === 'exclusive-race') await actual.writeFile(args[0], 'external winner');
      if (injection.mode === 'partial-write') {
        await actual.writeFile(args[0], String(args[1]).slice(0, 3), args[2]);
        throw fault('EIO');
      }
      await actual.writeFile(...args);
      await injection.afterWrite?.();
      if (injection.mode === 'after-write') throw fault('EIO');
    },
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
    const stream = actual.createReadStream(...args);
    if (String(args[0]) === injection.target && injection.writes > 0 && injection.mode === 'readback-revision') {
      stream.destroy(Object.assign(new Error('Injected revision read error'), { code: 'EIO' }));
    }
    return stream;
  } };
});

const directories: string[] = [];
const archers: Archer[] = [];
const signal = new AbortController().signal;
const writeFaults = ['after-write', 'partial-write', 'readback-stat', 'readback-missing', 'readback-eexist', 'readback-revision', 'readback-realpath'] as const;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture() {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'archer-write-recovery-'));
  directories.push(dir);
  const root = join(dir, 'workspace');
  await mkdir(root);
  const file = join(root, 'note.txt');
  await writeFile(file, 'original');
  injection.target = file;
  return { dir, root, file };
}

function target(): string { return 'note.txt'; }

function storageAt(dir: string): AgentJournal {
  return new JsonlAgentJournal(join(dir, 'agents'));
}

function makeArcher(dir: string, storage = storageAt(dir), onError?: (error: ArcherError) => void) {
  let inferences = 0;
  const archer = createArcher({
    camp: testCamp({ journal: storage,
      inference: { infer: async effect => {
      inferences += 1;
      if (effect.messages.some(message => message.role === 'tool' && message.toolName === effect.tools?.find(tool => tool.target.providerId + '.' + tool.target.capabilityId === 'files.write')?.name)) return { content: 'Written.' };
      return toolReply(effect, 'files.write', { path: 'note.txt', content: 'replacement' });
    } } }),
    ...(onError ? { onError } : {})
  });
  archers.push(archer);
  return { archer, inferences: () => inferences };
}

async function createWriter(archer: Archer, root: string) {
  return archer.agents.create({ id: 'writer', instructions: 'Write once.', workspace: { cwd: root, access: 'edit' } });
}

async function waitForUnknown(agent: Agent, turnId: string): Promise<void> {
  for await (const event of agent.turns.watch(turnId, { afterSeq: 0 })) {
    if (event.type === 'effect.unknown') return;
  }
  throw new Error('Expected an unknown write');
}

function expectUnresolvedWrite(events: readonly Snapshot<TurnEvent>[]) {
  const created = events.find((event) => event.type === 'effect.created' && event.data.effect.type === 'CALL' && event.data.effect.target.providerId + '.' + event.data.effect.target.capabilityId === 'files.write');
  if (!created || created.type !== 'effect.created') throw new Error('Missing CALL intent');
  const id = created.data.effectId;
  expect(events.filter((event) => event.type === 'effect.started' && event.data.effectId === id)).toHaveLength(1);
  expect(events.filter((event) => event.type === 'effect.unknown' && event.data.effectId === id)).toHaveLength(1);
  expect(events.some((event) => ['effect.completed', 'effect.failed', 'effect.cancelled', 'effect.resumed'].includes(event.type)
    && 'effectId' in event.data && event.data.effectId === id)).toBe(false);
}

afterEach(async () => {
  for (const archer of archers.splice(0).reverse()) await archer.stop();
  Object.assign(injection, { target: '', mode: 'none', writes: 0, afterWrite: undefined, onStat: undefined });
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('LocalFilesystem 写入结果边界', () => {
  it.each(writeFaults)('%s 返回 UNKNOWN，不能将实际写入当成确定失败', async (mode) => {
    const { root, file } = await fixture();
    injection.mode = mode;
    const result = await new LocalFilesystem(root).write(target(), { content: 'replacement' }, signal);
    expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN_SIDE_EFFECT' } });
    expect(injection.writes).toBe(1);
    expect(await readFile(file, 'utf8')).toBe(mode === 'partial-write' ? 'rep' : 'replacement');
  });

  it('写入调用之前的异常返回确定拒绝，文件保持不变', async () => {
    const { root, file } = await fixture();
    injection.mode = 'before-write';
    expect(await new LocalFilesystem(root).write(target(), { content: 'replacement' }, signal))
      .toMatchObject({ ok: false, error: { code: 'PROVIDER_ERROR' } });
    expect(injection.writes).toBe(0);
    expect(await readFile(file, 'utf8')).toBe('original');
  });

  it('排他创建的 EEXIST 是确定拒绝，不覆盖竞争者的内容', async () => {
    const { root, file } = await fixture();
    await rm(file);
    injection.mode = 'exclusive-race';
    expect(await new LocalFilesystem(root).write(target(), { content: 'replacement', expectedRevision: null }, signal))
      .toMatchObject({ ok: false, error: { code: 'ALREADY_EXISTS' } });
    expect(await readFile(file, 'utf8')).toBe('external winner');
  });

  it('异步准备期间到达的取消在 writeFile 前生效，不能继续发起写入', async () => {
    const { root, file } = await fixture();
    const cancellation = new AbortController();
    injection.onStat = () => cancellation.abort();
    expect(await new LocalFilesystem(root).write(target(), { content: 'replacement' }, cancellation.signal))
      .toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(injection.writes).toBe(0);
    expect(await readFile(file, 'utf8')).toBe('original');
  });
});

describe('真实文件工具的 UNKNOWN 恢复', () => {
  it.each(writeFaults)('%s 提交未知事实，多次重启仍等待对账且不重写文件', async (mode) => {
    const { dir, root, file } = await fixture();
    const first = makeArcher(dir);
    await first.archer.start();
    const agent = await createWriter(first.archer, root);
    injection.mode = mode;
    const ref = await agent.send('Write.');
    await waitForUnknown(agent, ref.turnId);
    const before = await agent.getState();
    expect(before.activeTurn).toMatchObject({ status: 'waiting', pending: { kind: 'reconcile' } });
    expectUnresolvedWrite(await agent.turns.events(ref.turnId));
    expect(first.inferences()).toBe(1);
    expect(injection.writes).toBe(1);
    await first.archer.stop();
    injection.mode = 'none';

    for (let restart = 0; restart < 2; restart += 1) {
      const recovered = makeArcher(dir);
      await recovered.archer.start();
      const restored = (await recovered.archer.agents.get('writer'))!;
      const state = await restored.getState();
      expect(state.activeTurn?.pending).toEqual(before.activeTurn?.pending);
      expect(state.activeTurn?.status).toBe('waiting');
      expect(state.messages).toEqual(before.messages);
      expectUnresolvedWrite(await restored.turns.events(ref.turnId));
      expect(recovered.inferences()).toBe(0);
      expect(injection.writes).toBe(1);
      expect(await readFile(file, 'utf8')).toBe(mode === 'partial-write' ? 'rep' : 'replacement');
      await recovered.archer.stop();
    }
  });
});

it('写入已发生后的取消请求不能把未知副作用变成已取消', async () => {
  const { dir, root, file } = await fixture();
  const entered = deferred();
  const release = deferred();
  const first = makeArcher(dir);
  await first.archer.start();
  const agent = await createWriter(first.archer, root);
  injection.mode = 'after-write';
  injection.afterWrite = async () => { entered.resolve(); await release.promise; };
  try {
    const ref = await agent.send('Write.');
    await entered.promise;
    await agent.abort({ reason: 'User requested cancellation.' });
    release.resolve();
    await waitForUnknown(agent, ref.turnId);
    const state = await agent.getState();
    expect(state.activeTurn).toMatchObject({ status: 'waiting', pending: { kind: 'reconcile' } });
    expectUnresolvedWrite(await agent.turns.events(ref.turnId));
    expect(await readFile(file, 'utf8')).toBe('replacement');
    expect(injection.writes).toBe(1);
  } finally {
    release.resolve();
  }
});

it.each(['before-append', 'after-append'] as const)('结果提交 %s 丢失确认，恢复只依据 JSONL 事实，不重放真实写入', async (failurePoint) => {
  const { dir, root, file } = await fixture();
  const storage = storageAt(dir);
  const isolated = deferred();
  let injected = false;
  const firstStorage: AgentJournal = {
    ids: () => storage.ids(), read: (...args) => storage.read(...args),
    append: async (input) => {
      const writeResult = input.drafts.some((draft) => draft.scope === 'turn' && draft.event.type === 'effect.completed'
        && draft.event.data.effectType === 'CALL' && Boolean((draft.event.data.result.value as { metadata?: { fileChange?: unknown } }).metadata?.fileChange));
      if (!injected && writeResult) {
        injected = true;
        if (failurePoint === 'after-append') await storage.append(input);
        throw new ArcherError('COMMIT_UNKNOWN', 'Injected result commit uncertainty');
      }
      return storage.append(input);
    },
  };
  const first = makeArcher(dir, firstStorage, (error) => {
    if (error.code === 'COMMIT_UNKNOWN') isolated.resolve();
  });
  await first.archer.start();
  const agent = await createWriter(first.archer, root);
  const ref = await agent.send('Write.');
  await isolated.promise;
  expect((await agent.getState()).execution).toBe('isolated');
  await first.archer.stop();

  const second = makeArcher(dir);
  await second.archer.start();
  const restored = (await second.archer.agents.get('writer'))!;
  if (failurePoint === 'after-append') await restored.wait(ref.turnId);
  const events = await restored.turns.events(ref.turnId);
  if (failurePoint === 'before-append') {
    expect((await restored.turns.get(ref.turnId))?.status).toBe('waiting');
    expectUnresolvedWrite(events);
  } else {
    expect((await restored.turns.get(ref.turnId))?.status).toBe('completed');
    expect(events.some((event) => event.type === 'effect.unknown')).toBe(false);
  }
  expect(second.inferences()).toBe(failurePoint === 'after-append' ? 2 : 0);
  expect(injection.writes).toBe(1);
  expect(await readFile(file, 'utf8')).toBe('replacement');
  const facts: readonly AgentEvent[] = await storageAt(dir).read('writer');
  const callId = events.flatMap(item => item.type === 'effect.created' && item.data.effect.type === 'CALL' && item.data.effect.target.capabilityId === 'write' ? [item.data.effectId] : [])[0];
  expect(facts.filter(event => event.fact.scope === 'turn' && event.fact.event.type === 'effect.started'
    && event.fact.event.data.effectType === 'CALL' && event.fact.event.data.effectId === callId)).toHaveLength(1);
});
