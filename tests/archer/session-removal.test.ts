/** 会话删除只提交 agent.removed；等待人工或对账的 Turn 不阻塞删除，执行中与排队输入仍须先处理。 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { Agent, Archer, Inference } from '@archer/contracts';
import { createArcher } from '@archer/runtime';
import { provider, tool } from '@archer/camp';
import { JsonlAgentJournal } from '@archer/storage';
import { testCamp } from '../helpers/application';
import { toolReply } from '../helpers/inference';

const running: Archer[] = [];
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const archer of running.splice(0)) await archer.stop();
  for (const action of cleanup.splice(0).reverse()) await action();
});

function memoryArcher(inference: Inference): Archer {
  const archer = createArcher({ camp: testCamp({ inference }) });
  running.push(archer);
  return archer;
}

async function journalDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'archer-removal-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function waitPending(agent: Agent): Promise<void> {
  await expect.poll(async () => (await agent.getState()).activeTurn?.pending?.kind).toMatch(/human|reconcile/);
}

it('等待人工确认的会话可以直接删除，旧凭证不能再推进', async () => {
  const archer = memoryArcher({
    infer: async effect => toolReply(effect, 'files.ask', { reason: 'Continue?', options: ['yes', 'no'] })
  });
  await archer.start();
  const agent = await archer.agents.create({ id: 'removable', instructions: 'Ask.' });
  await agent.send('Go');
  await waitPending(agent);
  const active = (await agent.getState()).activeTurn!;
  const target = { turnId: active.turnId, effectId: active.pending!.effectId };
  const token = await archer.agents.issueHumanToken(agent.id, target);

  await archer.agents.remove(agent.id);

  expect(await archer.agents.get(agent.id)).toBeNull();
  expect(await archer.agents.list()).toEqual([]);
  await expect((async () => archer.agents.reply(agent.id, { ...target, token: token.token, approved: true, response: 'yes' }))())
    .rejects.toMatchObject({ code: 'NOT_FOUND' });
});

it('执行中的 Turn 仍拒绝删除', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const archer = memoryArcher({ infer: async () => { await gate; return { content: 'Done.' }; } });
  await archer.start();
  const agent = await archer.agents.create({ id: 'busy', instructions: 'Work.' });
  const turn = await agent.send('Go');
  await expect.poll(async () => (await agent.getState()).activeTurn).not.toBeNull();
  await expect(archer.agents.remove(agent.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  release();
  await agent.wait(turn.turnId);
});

it('执行中或排队的会话在收束前仍拒绝删除', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const archer = memoryArcher({ infer: async () => { await gate; return { content: 'Done.' }; } });
  await archer.start();
  const agent = await archer.agents.create({ id: 'queued', instructions: 'Work.' });
  const turn = await agent.send('One');
  await expect.poll(async () => (await agent.getState()).activeTurn).not.toBeNull();
  await agent.followUp('Two');
  await expect(archer.agents.remove(agent.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  release();
  await agent.wait(turn.turnId);
  await expect.poll(async () => (await agent.getState()).queuedInputs.length).toBe(0);
  await expect.poll(async () => (await agent.getState()).activeTurn).toBeNull();
  await archer.agents.remove(agent.id);
  expect(await archer.agents.get(agent.id)).toBeNull();
});

it('重启后等待对账的未知写入可以不补写结果直接删除', async () => {
  const dir = await journalDir();
  const aborted = (signal: AbortSignal) => new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  let enter!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const source = provider('external', {
    write: tool({ description: 'Write.', execution: 'write', inputSchema: { type: 'object' }, invoke: async (_input, context) => { enter(); return aborted(context.signal); } })
  });
  const inference: Inference = { infer: async effect => effect.messages.at(-1)?.role === 'tool' ? { content: 'Done.' } : toolReply(effect, 'external.write') };

  const first = createArcher({ camp: testCamp({ journal: new JsonlAgentJournal(dir), inference, providers: [source] }) });
  running.push(first);
  await first.start();
  const agent = await first.agents.create({ id: 'crash', instructions: 'Write.' });
  await agent.send('Write.');
  await entered;
  await first.stop();

  const second = createArcher({ camp: testCamp({ journal: new JsonlAgentJournal(dir), inference, providers: [source] }) });
  running.push(second);
  await second.start();
  const restored = (await second.agents.get(agent.id))!;
  await waitPending(restored);
  expect((await restored.getState()).activeTurn?.pending?.kind).toBe('reconcile');

  await second.agents.remove(agent.id);

  expect(await second.agents.get(agent.id)).toBeNull();
  const events = await new JsonlAgentJournal(dir).read(agent.id);
  const facts = events.map(event => event.fact.event.type);
  expect(facts.at(-1)).toBe('agent.removed');
  expect(facts).not.toContain('turn.failed');
  expect(facts).not.toContain('effect.abandoned');
});
