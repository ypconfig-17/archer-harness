/** 完整执行结果落日志；给模型的输出有界且不复制元数据。 */
import { expect, it } from 'vitest';
import { createArcher } from '@archer/runtime';
import { provider, tool } from '@archer/camp';
import { MemoryAgentJournal } from '@archer/storage';
import { replayAgent } from '@archer/agent';
import { testCamp } from '../helpers/application';
import { toolReply } from '../helpers/inference';
it('显式正文只进入模型一次，完整结果仍可回放', async () => {
  const journal = new MemoryAgentJournal(); let executions = 0;
  const value = { output: 'BEGIN\n' + 'x'.repeat(70_000) + '\nEND', metadata: { detail: 'raw-metadata' } };
  const app = createArcher({ camp: testCamp({ journal, providers: [provider('output', { read: tool({ description: 'Read.', execution: 'read', resultView: 'output', inputSchema: { type: 'object' }, invoke: async () => { executions++; return value; } }) })],
    inference: { infer: async effect => {
      if (effect.messages.at(-1)?.role !== 'tool') return toolReply(effect, 'output.read');
      const text = effect.messages.at(-1)!.content; expect(text).toBe(value.output); expect(text).not.toContain('raw-metadata'); expect(text.startsWith('BEGIN')).toBe(true); expect(text.endsWith('END')).toBe(true); return { content: 'Done.' };
    } },
  }) });
  try { await app.start(); const agent = await app.agents.create({ id: 'output', instructions: 'Read.' }); await agent.prompt('Read.');
    const facts = await journal.read('output'); expect(JSON.stringify(facts)).toContain('raw-metadata'); expect(replayAgent('output', facts)?.activeTurnId).toBeNull(); expect(executions).toBe(1);
  } finally { await app.stop(); }
});
it.each(['read', 'write'] as const)('无效正文按 %s 语义归类', async execution => {
  const app = createArcher({ camp: testCamp({ providers: [provider('output', { bad: tool({ description: 'Bad output.', execution, resultView: 'output', inputSchema: { type: 'object' }, invoke: async () => ({ output: 42 }) }) })],
    inference: { infer: async effect => effect.messages.at(-1)?.role === 'tool' ? { content: 'Rejected.' } : toolReply(effect, 'output.bad') },
  }) });
  try { await app.start(); const agent = await app.agents.create({ id: 'invalid', instructions: 'Run.' }); const turn = await agent.send('Run.');
    await expect.poll(async () => (await agent.getState()).activeTurn?.status ?? 'completed').toBe(execution === 'write' ? 'waiting' : 'completed');
    expect((await agent.turns.events(turn.turnId)).some(event => event.type === (execution === 'write' ? 'effect.unknown' : 'effect.failed'))).toBe(true);
  } finally { await app.stop(); }
});
