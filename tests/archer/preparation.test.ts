/** 推理前准备由 Archer 显式选择，结果落事实，正文只作为本次参考。 */
import { expect, it } from 'vitest';
import { createCamp, provider, offer, INFERENCE, JOURNAL, INFERENCE_PREPARE } from '@archer/camp';
import { MemoryAgentJournal } from '@archer/storage';
import { createArcher } from '@archer/runtime';
it('未选中的准备能力不自动运行；选中的准备顺序固定并保留来源', async () => {
  const order: string[] = []; const journal = new MemoryAgentJournal();
  const camp = await createCamp({ providers: [
    provider('journal', { agents: offer(JOURNAL, { description: 'Journal.' }, journal) }),
    provider('prepare', {
      late: offer(INFERENCE_PREPARE, { description: 'Late.', input: { tag: 'late' }, order: 2 }, { prepare: async input => { order.push('late'); return input; } }),
      early: offer(INFERENCE_PREPARE, { description: 'Early.', input: { tag: 'early' }, order: 1 }, { prepare: async input => { order.push('early'); return input; } }),
      unused: offer(INFERENCE_PREPARE, { description: 'Unused.', input: {} }, { prepare: async () => { throw new Error('Must not run'); } }),
    }),
    provider('inference', { model: offer(INFERENCE, { description: 'Infer.' }, { infer: async effect => {
      expect(order).toEqual(['early', 'late']); const refs = effect.messages.filter(message => message.content.includes('preparation result'));
      expect(refs).toHaveLength(2); expect(refs[0]!.content).toContain('early'); expect(refs[0]!.content).not.toContain('providerId'); return { content: 'Done.' };
    } }) }),
  ] });
  const app = createArcher({ camp, preparations: camp.list(INFERENCE_PREPARE).filter(item => item.ref.capabilityId !== 'unused').map(item => item.ref) });
  try { await app.start(); const agent = await app.agents.create({ id: 'prepared', instructions: 'Answer.' }); await agent.prompt('Hello.');
    const facts = await journal.read(agent.id); expect(JSON.stringify(facts)).toContain('"capabilityId":"early"');
    expect((await agent.getState()).messages.some(message => message.content.includes('preparation result'))).toBe(false);
  } finally { await app.stop(); await camp.close(); }
});
