import { testCamp } from '../helpers/application';
import { TOOL } from '@archer/camp';
/** 文件同步丢失确认和取消不得被解释为确定未写入。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryProvider } from '@archer/memory';
import { createArcher, createArcherContextBuilder } from '@archer/runtime';
import { MemoryAgentJournal } from '@archer/storage';

import { toolReply } from '../helpers/inference';

const fault = vi.hoisted(() => ({ loseSyncConfirmation: false, abort: undefined as AbortController | undefined }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    const handle = await actual.open(...args);
    if (String(args[0]).endsWith('.jsonl')) {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        await sync();
        fault.abort?.abort();
        if (fault.loseSyncConfirmation) throw new Error('Sync confirmation lost');
      };
    }
    return handle;
  } };
});
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  fault.loseSyncConfirmation = false;
  fault.abort = undefined;
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'archer-memory-boundary-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return root;
}

it('同步确认丢失后冻结追加，允许读取观察，全部关闭重开后显式幂等重试', async () => {
  const root = await directory();
  const context = createArcherContextBuilder().build();
  cleanups.push(() => context.dispose());
  const boot = async () => {
    const resource = memoryProvider({ directory: root, namespace: 'scope' });
    cleanups.push(() => resource.close?.());
    await resource.open?.({ signal: context.signal });

    return { resource, invoke: (name: string, input: unknown, signal = context.signal) => resource.capabilities[name]!.implementation.invoke(input, { signal }) };
  };
  const first = await boot(), second = await boot();
  fault.loseSyncConfirmation = true;
  await expect(first.invoke('append', { id: 'same', content: 'Persisted fact.' })).rejects.toMatchObject({ code: 'COMMIT_UNKNOWN' });
  expect(await second.invoke('get', { id: 'same' })).toMatchObject({ entry: { id: 'same' } });
  fault.loseSyncConfirmation = false;
  await expect(second.invoke('append', { id: 'same', content: 'Persisted fact.' })).rejects.toMatchObject({ code: 'COMMIT_UNKNOWN' });
  await first.resource.close?.();
  await second.resource.close?.();
  const restored = await boot();
  expect(await restored.invoke('append', { id: 'same', content: 'Persisted fact.' })).toMatchObject({ created: false, entry: { seq: 1 } });
  const file = join(root, (await readdir(root))[0]);
  expect((await readFile(file, 'utf8')).trim().split('\n')).toHaveLength(1);
});

it('取消在写入和同步后到达，仍返回已确认成功结果', async () => {
  const root = await directory();
  const context = createArcherContextBuilder().build();
  cleanups.push(() => context.dispose());
  const resource = memoryProvider({ directory: root, namespace: 'scope' });
  cleanups.push(() => resource.close?.());
  await resource.open?.({ signal: context.signal });

  const controller = new AbortController();
  fault.abort = controller;
  expect(await resource.capabilities.append!.implementation.invoke( { id: 'confirmed', content: 'Confirmed.' }, { signal: controller.signal })).toMatchObject({ created: true });
  expect(controller.signal.aborted).toBe(true);
  fault.abort = undefined;
  expect(await resource.capabilities.get!.implementation.invoke( { id: 'confirmed' }, { signal: context.signal })).toMatchObject({ entry: { seq: 1 } });
});

describe('记忆写入与 Runtime 恢复', () => {
  it('未知写入不自动重跑，重启后由显式 retry 复用原输入并去重', async () => {
    const root = await directory();
    const journal = new MemoryAgentJournal();
    const infer = async (effect: Parameters<typeof toolReply>[0]) => effect.messages.some(message => message.role === 'tool')
      ? { content: 'done' } : toolReply(effect, 'memory.append', { id: 'language', content: '用户希望中文回答。' });
    const first = createArcher({ camp: testCamp({ journal, inference: { infer }, providers: [memoryProvider({ directory: root, namespace: 'scope' })] }) });
    cleanups.push(() => first.stop());
    await first.start();
    const agent = await first.agents.create({ id: 'unknown-memory', instructions: 'Save the preference.' });
    fault.loseSyncConfirmation = true;
    const turn = await agent.send('Remember my language.');
    await expect.poll(async () => (await agent.getState()).activeTurn?.pending?.kind).toBe('reconcile');
    expect(await first.camp.resolve(first.camp.list(TOOL).find(item => item.ref.providerId === 'memory' && item.ref.capabilityId === 'get')!.ref, TOOL).invoke({ id: 'language' }, { signal: first.camp.signal })).toMatchObject({ entry: { seq: 1 } });
    fault.loseSyncConfirmation = false;
    await first.stop();
    const second = createArcher({ camp: testCamp({ journal, inference: { infer }, providers: [memoryProvider({ directory: root, namespace: 'scope' })] }) });
    cleanups.push(() => second.stop());
    await second.start();
    const restored = await second.agents.get(agent.id);
    const pending = (await restored!.getState()).activeTurn!.pending!;
    expect(pending.kind).toBe('reconcile');
    await second.agents.reconcile(agent.id, { turnId: turn.turnId, effectId: pending.effectId, decision: { kind: 'retry' } });
    await restored!.wait(turn.turnId);
    const file = join(root, (await readdir(root))[0]);
    expect((await readFile(file, 'utf8')).trim().split('\n')).toHaveLength(1);
    expect((await restored!.turns.events(turn.turnId)).some(event => event.type === 'effect.unknown')).toBe(true);
  });
});
