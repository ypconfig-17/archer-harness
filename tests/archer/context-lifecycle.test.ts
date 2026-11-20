/** 项目参考、完整上下文与事实通过真实 Turn 链路验证。 */
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createCamp, provider, offer, tool, JOURNAL, INFERENCE, INFERENCE_PREPARE } from '@archer/camp';
import { MemoryAgentJournal } from '@archer/storage';
import { createArcher } from '@archer/runtime';
import { projectContextProvider } from '@archer/providers';
import { replayAgent } from '@archer/agent';
import { toolReply } from '../helpers/inference';
it('参考位于对话前缀后，不取代用户请求；未知窗口不擅自裁剪旧输出，回放保留全文', async () => {
  const root = await mkdtemp(join(tmpdir(), 'archer-context-lifecycle-')); await writeFile(join(root, 'AGENTS.md'), 'Always cite observed source.');
  const journal = new MemoryAgentJournal(); let inferenceSteps = 0; let invocations = 0; let fullHistory = false;
  const camp = await createCamp({ providers: [projectContextProvider(),
    provider('journal', { agents: offer(JOURNAL, { description: 'Journal.' }, journal) }),
    provider('reader', { read: tool({ description: 'Read large output.', execution: 'read', inputSchema: { type: 'object' }, invoke: async () => { invocations++; return `source-${invocations}:` + 'x'.repeat(30_000); } }) }),
    provider('inference', { model: offer(INFERENCE, { description: 'Model.' }, { infer: async effect => {
      const references = effect.messages.filter(message => message.content.includes('preparation result'));
      expect(references).toHaveLength(1); expect(references[0]!.content).toContain('Always cite observed source.');
      expect(effect.messages.indexOf(references[0]!)).toBeLessThan(effect.messages.findIndex(message => message.content === 'Review the architecture.'));
      expect(effect.messages.some(message => message.role === 'user' && message.content === 'Review the architecture.')).toBe(true);
      const results = effect.messages.filter(message => message.role === 'tool');
      expect(results.every(message => message.content.length > 30_000)).toBe(true);
      if (results.length === 6) fullHistory = true;
      return inferenceSteps++ < 6 ? toolReply(effect, 'reader.read') : { content: 'Verified architecture.' };
    } }) }),
  ] });
  const archer = createArcher({ camp, preparations: camp.list(INFERENCE_PREPARE).map(item => item.ref) });
  try {
    await archer.start(); const agent = await archer.agents.create({ id: 'context', instructions: 'Review carefully.', workspace: { cwd: root, access: 'read' } }); await agent.prompt('Review the architecture.');
    expect(fullHistory).toBe(true); expect(invocations).toBe(6);
    const state = await agent.getState(); expect(state.messages.filter(message => message.role === 'tool').every(message => message.content.length > 30_000)).toBe(true);
    expect(state.messages.some(message => message.content.includes('preparation result'))).toBe(false);
    const facts = await journal.read(agent.id); const restored = replayAgent(agent.id, facts)!;
    expect(restored.messages).toEqual(state.messages);
    expect(JSON.stringify(facts)).toContain('"summarizedMessages":');
    expect((await agent.getState()).messages.at(-1)?.content).toBe('Verified architecture.');
  } finally { await archer.stop(); await camp.close(); await rm(root, { recursive: true, force: true }); }
});
