/** 历史证据读取使用真实 CALL 装配，隔离当前 Agent 并保留结果视图。 */
import { expect, it } from 'vitest';
import { createArcher } from '@archer/runtime';
import { MemoryAgentJournal } from '@archer/storage';
import { provider, tool } from '@archer/camp';
import { historyProvider } from '@archer/providers';
import type { HistoryPage } from '@archer/contracts';
import { testCamp } from '../helpers/application';
import { toolReply } from '../helpers/inference';

it('分页恢复原模型正文、隐藏元数据、拒绝跨 Agent，重启读取不重跑旧工具', async () => {
  const journal = new MemoryAgentJournal(); let executions = 0;
  let requested: { callId: string; turnId?: string; offset?: number; limit?: number } | undefined;
  const pages: HistoryPage[] = [];
  const providers = [historyProvider(), provider('source', { read: tool({ description: 'Read.', inputSchema: { type: 'object' }, execution: 'read', resultView: 'output', invoke: () => {
    executions++; return { output: 'A'.repeat(8200) + '😀END', metadata: { secret: 'HIDDEN' }, isError: true };
  } }) })];
  const inference = { infer: async (effect: import('@archer/contracts').InferEffect) => {
    const last = effect.messages.at(-1);
    if (last?.role === 'tool') {
      if (requested) pages.push(JSON.parse(last.content));
      return { content: 'Done.' };
    }
    return toolReply(effect, requested ? 'history.read' : 'source.read', requested ?? {});
  } };
  let app = createArcher({ camp: testCamp({ journal, inference, providers, builtins: false }) });
  await app.start();
  try {
    const a = await app.agents.create({ id: 'history-a', instructions: 'Read evidence.' });
    const b = await app.agents.create({ id: 'history-b', instructions: 'Read evidence.' });
    await a.prompt('Read original.');
    const event = (await journal.read(a.id)).find(event => event.fact.event.type === 'effect.created' && event.fact.event.data.effect.type === 'CALL')!;
    if (event.fact.scope !== 'turn' || event.fact.event.type !== 'effect.created' || event.fact.event.data.effect.type !== 'CALL') throw new Error('Missing source call');
    requested = { turnId: event.fact.turnId, callId: event.fact.event.data.effect.toolCallId!, limit: 8192 };
    await a.prompt('Read first page.');
    expect(pages[0]).toMatchObject({ content: 'A'.repeat(8192), offset: 0, nextOffset: 8192, isError: true });
    expect(JSON.stringify(pages)).not.toContain('HIDDEN');
    await app.stop();
    app = createArcher({ camp: testCamp({ journal, inference, providers, builtins: false }) }); await app.start();
    requested = { ...requested, offset: pages[0]!.nextOffset };
    await (await app.agents.get(a.id))!.prompt('Read remaining page.');
    expect(pages[1]!.content).toBe('A'.repeat(8) + '😀END');
    expect(pages[1]!.nextOffset).toBeUndefined();
    const { committedHistory } = await import('../../packages/runtime/src/archer/history');
    const { replayAgent } = await import('@archer/agent');
    const reader = committedHistory(replayAgent(a.id, await journal.read(a.id))!).history;
    expect(() => reader.read({ ...requested!, offset: 8200, limit: 1 })).toThrow('Unicode character');
    expect(reader.read({ ...requested!, offset: 8200, limit: 2 })).toMatchObject({ content: '😀', nextOffset: 8202 });
    expect(() => reader.read({ ...requested!, offset: 8201, limit: 2 })).toThrow('Unicode character');
    expect(executions).toBe(1);
    await (await app.agents.get(b.id))!.prompt('Read another agent result.');
    expect((await journal.read(b.id)).some(event => event.fact.event.type === 'effect.failed' && event.fact.event.data.error.code === 'NOT_FOUND')).toBe(true);
  } finally { await app.stop(); }
});

it('精确绑定 Turn 与 callId，超界分页拒绝，快照不读取未来结果', async () => {
  const { committedHistory } = await import('../../packages/runtime/src/archer/history');
  const { replayAgent } = await import('@archer/agent');
  const journal = new MemoryAgentJournal();
  const app = createArcher({ camp: testCamp({ journal, builtins: false, providers: [provider('source', { read: tool({ description: 'Read.', inputSchema: { type: 'object' }, execution: 'read', resultView: 'output', invoke: () => ({ output: 'Original evidence.', metadata: { fileChange: { path: 'a.ts', revisionBefore: null, revisionAfter: 'rev-a', after: 'PRIVATE CONTENT' }, command: { exitCode: 2, stdout: 'not a status' }, secret: 'HIDDEN' } }) }) })], inference: { infer: async effect => {
    const last = effect.messages.at(-1);
    if (last?.role === 'tool' || last?.content.startsWith('[System observation]')) return { content: 'Done.' };
    return toolReply(effect, 'source.read');
  } } }) });
  await app.start();
  try {
    const agent = await app.agents.create({ id: 'duplicates', instructions: 'Read.' });
    await agent.prompt('First.');
    const first = committedHistory(replayAgent(agent.id, await journal.read(agent.id))!);
    const callId = first.facts[0]!.callId!;
    expect(first.history.read({ callId, limit: 4 })).toMatchObject({ content: 'Orig', nextOffset: 4 });
    expect(first.facts[0]).toMatchObject({ fileChange: { path: 'a.ts', revisionBefore: null, revisionAfter: 'rev-a' }, command: { exitCode: 2 } });
    expect(JSON.stringify(first.facts)).not.toContain('PRIVATE CONTENT');
    expect(JSON.stringify(first.facts)).not.toContain('HIDDEN');
    await agent.prompt('Second.');
    const second = committedHistory(replayAgent(agent.id, await journal.read(agent.id))!);
    expect(second.history.read({ callId, turnId: first.facts[0]!.turnId }).content).toBe('Original evidence.');
    expect(() => second.history.read({ callId, turnId: first.facts[0]!.turnId, offset: 100 })).toThrow('offset exceeds');
    expect(() => second.history.read({ callId, limit: 8193 })).toThrow();
    expect(first.history.read({ callId }).content).toBe('Original evidence.');
    expect(() => first.history.read({ callId, turnId: second.facts.at(-1)!.turnId })).toThrow('No committed');
  } finally { await app.stop(); }
});

it('超大结果只在真实请求中节选，回放后仍能分页读到完整正文且不重跑副作用', async () => {
  const { committedHistory } = await import('../../packages/runtime/src/archer/history');
  const { replayAgent } = await import('@archer/agent');
  const journal = new MemoryAgentJournal();
  const original = '😀evidence'.repeat(20_000);
  let executions = 0;
  let visible = '';
  const app = createArcher({ camp: testCamp({
    journal,
    builtins: false,
    providers: [historyProvider(), provider('source', { read: tool({
      description: 'Read.', inputSchema: { type: 'object' }, execution: 'read', resultView: 'output',
      invoke: () => {
        executions++;
        return { output: original, metadata: { secret: 'HIDDEN' } };
      },
    }) })],
    inference: {
      measure: request => ({ contextWindow: 20_000, maxOutputTokens: 2000,
        estimatedInputTokens: JSON.stringify(request.messages).length, method: 'test-characters' }),
      infer: async request => {
        const last = request.messages.at(-1);
        if (last?.role === 'tool') {
          visible = last.content;
          return { content: 'Done.' };
        }
        return toolReply(request, 'source.read');
      },
    },
  }) });
  await app.start();
  try {
    const agent = await app.agents.create({ id: 'large-result', instructions: 'Read evidence.' });
    await agent.prompt('Read original.');
    expect(visible).toContain('Tool output excerpt');
    expect(visible).toContain('history_read');
    expect(visible.length).toBeLessThan(6000);
    const state = replayAgent(agent.id, await journal.read(agent.id))!;
    const snapshot = committedHistory(state);
    const callId = snapshot.facts[0]!.callId!;
    expect(snapshot.history.read({ callId, offset: original.length - 8 }).content).toBe(original.slice(-8));
    expect(JSON.stringify(state.messages)).not.toContain('Tool output excerpt');
    expect(JSON.stringify(state.messages)).not.toContain('HIDDEN');
    expect(executions).toBe(1);
  } finally {
    await app.stop();
  }
});
