/** Archer 只借用外部 Camp；拥有资源的装配入口负责最终关闭。 */
import { expect, it, vi } from 'vitest';
import { createCamp, provider, offer, INFERENCE, JOURNAL, tool } from '@archer/camp';
import { MemoryAgentJournal } from '@archer/storage';
import { createArcher } from '@archer/runtime';
import { testCamp } from '../helpers/application';
import { toolReply } from '../helpers/inference';
it('两个 Archer 借用同一 Camp，停止一个不会关闭共享 Provider', async () => {
  const close = vi.fn();
  const camp = await createCamp({ providers: [
    provider('journal', { agents: offer(JOURNAL, { description: 'Journal.' }, new MemoryAgentJournal()) }),
    provider('inference', { model: offer(INFERENCE, { description: 'Inference.' }, { infer: async () => ({ content: 'Done.' }) }) }, { close }),
  ] });
  const a = createArcher({ camp }); const b = createArcher({ camp });
  try { await a.start(); await b.start(); await a.stop(); expect(close).not.toHaveBeenCalled();
    await (await b.agents.create({ id: 'b', instructions: 'Reply.' })).prompt('Hi.');
  } finally { await a.stop(); await b.stop(); await camp.close(); }
  expect(close).toHaveBeenCalledOnce();
});
it('单实例契约歧义必须显式选择，不能按扫描顺序决定默认模型', async () => {
  const camp = await createCamp({ providers: [
    provider('journal', { agents: offer(JOURNAL, { description: 'Journal.' }, new MemoryAgentJournal()) }),
    ...['a', 'b'].map(id => provider(id, { model: offer(INFERENCE, { description: id }, { infer: async () => ({ content: id }) }) })),
  ] });
  const ambiguous = createArcher({ camp });
  await expect(ambiguous.start()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  const selected = createArcher({ camp, inference: camp.list(INFERENCE).find(item => item.ref.providerId === 'b')!.ref });
  try { await selected.start(); const agent = await selected.agents.create({ id: 'chosen', instructions: 'Reply.' }); await agent.prompt('Hi.'); expect((await agent.getState()).messages.at(-1)?.content).toBe('b'); }
  finally { await selected.stop(); await camp.close(); }
});
it('停止超时不会提前释放仍在执行的 Provider；实际收束后只关闭一次', async () => {
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  const close = vi.fn();
  const source = provider('slow', { run: tool({ description: 'Slow write.', inputSchema: { type: 'object' }, execution: 'write', invoke: async () => { enter(); await gate; return 'done'; } }) }, { close });
  const app = createArcher({ camp: testCamp({ providers: [source], inference: { infer: async effect => toolReply(effect, 'slow.run') } }) });
  await app.start(); const agent = await app.agents.create({ id: 'slow', instructions: 'Run.' }); await agent.send('Run.'); await entered;
  await expect(app.stop({ timeoutMs: 10 })).rejects.toMatchObject({ code: 'SHUTDOWN_TIMEOUT' }); expect(close).not.toHaveBeenCalled();
  release(); await app.stop(); expect(close).toHaveBeenCalledOnce();
});
it('停止后的 Archer 实例不能再次启动', async () => {
  const app = createArcher({ camp: testCamp() }); await app.start(); await app.stop(); await expect(app.start()).rejects.toThrow('restarted');
});
