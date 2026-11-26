import { handoffFor } from '../helpers/handoff';
/** 上下文管理通过真实提交端口验证，摘要和普通推理都必须先记请求再调用。 */
import { afterEach, expect, it } from 'vitest';
import { ArcherError, type AgentJournal, type Archer, type Inference, type Provider } from '@archer/contracts';
import { provider, tool } from '@archer/camp';
import { toolReply } from '../helpers/inference';
import { AgentEventSchema } from '@archer/contracts';
import { createArcher } from '@archer/runtime';
import { MemoryAgentJournal } from '@archer/storage';
import { replayAgent } from '@archer/agent';
import { testCamp } from '../helpers/application';

const applications: Archer[] = [];
afterEach(async () => { for (const app of applications.splice(0).reverse()) await app.stop(); });
async function application(journal: AgentJournal, inference: Inference, providers: Provider[] = []) {
  const app = createArcher({ camp: testCamp({ journal, inference, providers, builtins: false }) });
  applications.push(app); await app.start(); return app;
}
const measure: NonNullable<Inference['measure']> = effect => ({
  contextWindow: 18_000, maxOutputTokens: 4096,
  estimatedInputTokens: Math.ceil(JSON.stringify({ messages: effect.messages, tools: effect.tools }).length / 4), method: 'test-text-estimator',
});

it('摘要与普通请求独立记账，摘要提交后复用；重启保留摘要和完整历史', async () => {
  const journal = new MemoryAgentJournal(); let bounded = false; let summaries = 0;
  const inference: Inference = {
    measure: effect => bounded ? measure(effect) : { ...measure(effect), contextWindow: 1_000_000 },
    infer: async effect => {
      const last = (await journal.read('context')).at(-1)!.fact.event;
      expect(last.type).toBe('inference.requested');
      if (effect.messages[0]?.content.startsWith('Summarize the supplied')) {
        summaries++;
        expect(effect.tools).toBeUndefined(); expect(effect.preparations).toBeUndefined();
        return { content: handoffFor(effect), usage: { promptTokens: 90, completionTokens: 10 } };
      }
      if (bounded) {
        expect(effect.messages.some(message => message.content.includes('model-generated reference'))).toBe(true);
        expect(effect.messages.filter(message => message.role === 'user' && message.content.startsWith('User goal '))).toHaveLength(13);
      }
      return { content: bounded ? 'Finished.' : 'Observed '.repeat(500), usage: { promptTokens: 90, completionTokens: 10 } };
    },
  };
  const app = await application(journal, inference);
  const agent = await app.agents.create({ id: 'context', instructions: 'Preserve user constraints.' });
  for (let index = 0; index < 12; index++) await agent.prompt(`User goal ${index}`);
  bounded = true;
  await agent.prompt('User goal 12', { limits: { tokenBudget: 201 } });
  expect(summaries).toBeGreaterThan(0);
  const events = await journal.read(agent.id);
  const restored = replayAgent(agent.id, events)!;
  expect(restored.compactions).toHaveLength(summaries);
  const tampered = structuredClone(events);
  const adoption = tampered.find(event => event.fact.event.type === 'context.compacted')!;
  if (adoption.fact.event.type !== 'context.compacted') throw new Error('Missing adoption');
  const requestId = adoption.fact.event.data.requestId;
  adoption.fact.event.data.summary = 'Unstructured summary';
  const response = tampered.find(event => event.fact.event.type === 'inference.responded' && event.fact.event.data.requestId === requestId)!;
  if (response.fact.event.type !== 'inference.responded') throw new Error('Missing response');
  response.fact.event.data.result.content = 'Unstructured summary';
  expect(() => replayAgent(agent.id, tampered)).toThrow('Invalid structured handoff');
  expect(restored.messages.filter(message => message.role === 'assistant' && message.content.length > 4000)).toHaveLength(12);
  const lastTurn = [...restored.turns.values()].at(-1)!;
  expect(lastTurn.effects.flatMap(effect => effect.inferenceRequests).map(request => request.purpose)).toEqual(['compaction', 'agent']);
  const summaryIndex = events.findIndex(event => event.fact.event.type === 'context.compacted');
  const nextRequest = events.slice(summaryIndex + 1).find(event => event.fact.event.type === 'inference.requested');
  expect(nextRequest?.fact.event).toMatchObject({ type: 'inference.requested', data: { purpose: 'agent' } });
  await app.stop();
  const second = await application(journal, { measure, infer: async effect => {
    expect(effect.messages.some(message => message.content.includes('model-generated reference'))).toBe(true);
    return { content: 'Still remembered.', usage: { promptTokens: 1, completionTokens: 1 } };
  } });
  await (await second.agents.get(agent.id))!.prompt('Continue.');
  expect(replayAgent(agent.id, await journal.read(agent.id))!.compactions).toHaveLength(summaries);
});

it('巨大用户输入超窗时明确失败，不发送模型请求也不截断原始输入', async () => {
  const journal = new MemoryAgentJournal(); let calls = 0;
  const app = await application(journal, { measure, infer: async () => { calls++; return { content: 'Should not run.' }; } });
  const agent = await app.agents.create({ id: 'large', instructions: 'Reply.' });
  const input = 'Required input '.repeat(6000);
  const turn = await agent.send(input);
  await expect(agent.wait(turn.turnId)).rejects.toMatchObject({ code: 'TURN_FAILED' });
  expect(calls).toBe(0);
  expect((await agent.getState()).messages[0]?.content).toBe(input);
  expect((await agent.turns.events(turn.turnId)).at(-1)).toMatchObject({ type: 'turn.failed', data: { error: { code: 'CONTEXT_BUDGET_EXCEEDED' } } });
});

it.each(['before', 'after'] as const)('真实模型请求提交 %s 丢失确认时隔离且不调用模型', async point => {
  const storage = new MemoryAgentJournal(); let calls = 0;
  const journal: AgentJournal = {
    ids: () => storage.ids(), read: (...args) => storage.read(...args),
    append: async input => {
      if (input.drafts.some(draft => draft.event.type === 'inference.requested')) {
        if (point === 'after') await storage.append(input);
        throw new ArcherError('COMMIT_UNKNOWN', 'Unknown request commit.');
      }
      return storage.append(input);
    },
  };
  const app = await application(journal, { infer: async () => { calls++; return { content: 'Unexpected.' }; } });
  const agent = await app.agents.create({ id: 'uncertain', instructions: 'Reply.' });
  const turn = await agent.send('Hello.');
  await expect(agent.wait(turn.turnId)).rejects.toMatchObject({ code: 'AGENT_ISOLATED' });
  expect(calls).toBe(0);
  expect((await agent.getState()).execution).toBe('isolated');
});

it('响应已提交但外层完成确认丢失，重启直接复用模型结果', async () => {
  const storage = new MemoryAgentJournal(); let calls = 0;
  const journal: AgentJournal = {
    ids: () => storage.ids(), read: (...args) => storage.read(...args),
    append: async input => {
      if (input.drafts.some(draft => draft.event.type === 'effect.completed')) throw new ArcherError('COMMIT_UNKNOWN', 'Outer completion unknown.');
      return storage.append(input);
    },
  };
  const inference: Inference = { infer: async () => { calls++; return { content: 'Confirmed answer.', usage: { promptTokens: 2, completionTokens: 3 } }; } };
  const app = await application(journal, inference);
  const agent = await app.agents.create({ id: 'reuse', instructions: 'Reply.' });
  const turn = await agent.send('Hello.', { limits: { tokenBudget: 5 } });
  await expect(agent.wait(turn.turnId)).rejects.toMatchObject({ code: 'AGENT_ISOLATED' });
  await app.stop();
  const second = await application(storage, inference);
  const restored = (await second.agents.get(agent.id))!;
  await restored.wait(turn.turnId);
  expect(calls).toBe(1);
  expect((await restored.getState()).messages.at(-1)?.content).toBe('Confirmed answer.');
});

it.each(['budget', 'invalid'] as const)('摘要 %s 边界阻止普通推理，已产生的摘要用量仍保留', async mode => {
  const journal = new MemoryAgentJournal(); let bounded = false; let ordinaryCalls = 0;
  const app = await application(journal, {
    measure: effect => bounded ? measure(effect) : { ...measure(effect), contextWindow: 1_000_000 },
    infer: async effect => {
      if (effect.messages[0]?.content.startsWith('Summarize the supplied')) return {
        content: mode === 'invalid' ? '' : handoffFor(effect), usage: { promptTokens: 90, completionTokens: 10 },
      };
      if (bounded) ordinaryCalls++;
      return { content: 'Observed '.repeat(500), usage: { promptTokens: 1, completionTokens: 1 } };
    },
  });
  const agent = await app.agents.create({ id: 'summary-boundary', instructions: 'Reply.' });
  for (let index = 0; index < 12; index++) await agent.prompt(`Goal ${index}`);
  bounded = true;
  const turn = await agent.send('Continue.', { limits: { tokenBudget: 100 } });
  await expect(agent.wait(turn.turnId)).rejects.toMatchObject({ code: 'TURN_FAILED' });
  expect(ordinaryCalls).toBe(0);
  expect((await agent.turns.events(turn.turnId)).at(-1)).toMatchObject({ type: 'turn.failed', data: { error: { code: mode === 'budget' ? 'TOKEN_BUDGET_EXCEEDED' : 'CONTEXT_COMPACTION_INVALID' } } });
  const state = replayAgent(agent.id, await journal.read(agent.id))!;
  expect([...state.turns.values()].at(-1)!.effects.at(-1)!.inferenceRequests[0]?.result?.usage).toEqual({ promptTokens: 90, completionTokens: 10 });
  expect(state.compactions).toHaveLength(mode === 'budget' ? 1 : 0);
});

it.each(['before', 'after'] as const)('摘要采用提交 %s 丢失确认，恢复复用已确认摘要且不重复花费', async point => {
  const storage = new MemoryAgentJournal(); let bounded = false; let summaries = 0; let injected = false;
  const journal: AgentJournal = {
    ids: () => storage.ids(), read: (...args) => storage.read(...args),
    append: async input => {
      if (!injected && input.drafts.some(draft => draft.event.type === 'context.compacted')) {
        injected = true;
        if (point === 'after') await storage.append(input);
        throw new ArcherError('COMMIT_UNKNOWN', 'Unknown summary adoption.');
      }
      return storage.append(input);
    },
  };
  const inference: Inference = {
    measure: effect => bounded ? measure(effect) : { ...measure(effect), contextWindow: 1_000_000 },
    infer: async effect => {
      if (effect.messages[0]?.content.startsWith('Summarize the supplied')) {
        summaries++; return { content: handoffFor(effect), usage: { promptTokens: 90, completionTokens: 10 } };
      }
      if (bounded) expect(effect.messages.some(message => message.content.includes('model-generated reference'))).toBe(true);
      return { content: bounded ? 'Recovered.' : 'Observed '.repeat(500), usage: { promptTokens: 1, completionTokens: 1 } };
    },
  };
  const first = await application(journal, inference);
  const agent = await first.agents.create({ id: 'adoption', instructions: 'Reply.' });
  for (let index = 0; index < 12; index++) await agent.prompt(`Goal ${index}`);
  bounded = true;
  const turn = await agent.send('Continue.', { limits: { tokenBudget: 102 } });
  await expect(agent.wait(turn.turnId)).rejects.toMatchObject({ code: 'AGENT_ISOLATED' });
  await first.stop();
  const second = await application(storage, inference);
  const restored = (await second.agents.get(agent.id))!;
  await restored.wait(turn.turnId);
  expect(summaries).toBe(1);
  const state = replayAgent(agent.id, await storage.read(agent.id))!;
  expect(state.compactions).toHaveLength(1);
  expect([...state.turns.values()].at(-1)!.effects.at(-1)!.inferenceRequests).toHaveLength(2);
  const corrupted = structuredClone(await storage.read(agent.id));
  const adopted = corrupted.find(event => event.fact.event.type === 'context.compacted')!;
  if (adopted.fact.event.type === 'context.compacted') adopted.fact.event.data.coveredMessageCount++;
  expect(() => replayAgent(agent.id, corrupted)).toThrow('摘要输入、覆盖边界或输出无效');
});

it('工具批次摘要经过 JSONL Schema 规范化后仍能回放，键顺序不影响来源校验', async () => {
  const journal = new MemoryAgentJournal(); let bounded = false;
  const app = await application(journal, {
    measure: effect => bounded ? measure(effect) : { ...measure(effect), contextWindow: 1_000_000 },
    infer: async effect => {
      if (effect.messages[0]?.content.startsWith('Summarize the supplied')) return { content: handoffFor(effect), usage: { promptTokens: 1, completionTokens: 1 } };
      if (bounded) return { content: 'Finished.', usage: { promptTokens: 1, completionTokens: 1 } };
      return effect.messages.at(-1)?.role === 'tool' ? { content: 'Observed '.repeat(500) } : toolReply(effect, 'reader.read');
    },
  }, [provider('reader', { read: tool({ description: 'Read.', inputSchema: { type: 'object' }, execution: 'read', resultView: 'output', invoke: async () => ({ output: 'Observation.', isError: true }) }) })]);
  const agent = await app.agents.create({ id: 'normalized', instructions: 'Read and reply.' });
  for (let index = 0; index < 12; index++) await agent.prompt(`Goal ${index}`);
  bounded = true; await agent.prompt('Continue.');
  const events = await journal.read(agent.id);
  const normalized = events.map(event => AgentEventSchema.parse(JSON.parse(JSON.stringify(event))));
  const restored = replayAgent(agent.id, normalized)!;
  expect(restored.compactions.length).toBeGreaterThan(0);
  expect(restored.messages.filter(message => message.role === 'tool')).toHaveLength(12);
});

it('连续摘要保留历史索引和作用范围，继承引用仍重验；报告开销不声称语义无损', async () => {
  const { handoffReport } = await import('@archer/handler');
  const journal = new MemoryAgentJournal(); let bounded = false;
  const app = await application(journal, {
    measure: effect => bounded ? measure(effect) : { ...measure(effect), contextWindow: 1_000_000 },
    infer: async effect => {
      if (effect.messages[0]?.content.startsWith('Summarize the supplied')) {
        const input = JSON.parse(effect.messages[1]!.content) as { previousSummary?: string };
        const base = handoffFor(effect);
        const marker = input.previousSummary ? '\n\n### Inherited\n- Anchor: first-summary' : '\n\n### Inherited\n- Anchor: first-summary';
        return { content: `${base}${marker}`, usage: { promptTokens: 90, completionTokens: 10 } };
      }
      if (bounded && effect.messages.some(message => message.content.includes('model-generated reference'))) {
        expect(effect.messages.some(message => message.content.includes('Historical scope: original history indices [0,') && message.content.includes('Later original messages may update'))).toBe(true);
      }
      return { content: 'Observed '.repeat(500), usage: { promptTokens: 1, completionTokens: 1 } };
    },
  });
  const agent = await app.agents.create({ id: 'continuity', instructions: 'Preserve original constraints.' });
  for (let index = 0; index < 36; index++) { bounded = index >= 12; await agent.prompt(`Goal ${index}`); }
  const events = await journal.read(agent.id);
  const state = replayAgent(agent.id, events)!;
  expect(state.compactions.length).toBeGreaterThanOrEqual(3);
  expect(state.messages.filter(message => message.role === 'assistant' && message.content.length > 4000)).toHaveLength(36);
  for (const compacted of state.compactions) expect(compacted.summary).toContain('Anchor: first-summary');
  const report = handoffReport(state);
  expect(report.semanticQuality).toBe('not-measured');
  expect(report.measurements.some(item => item.purpose === 'agent')).toBe(true);
  expect(report.measurements.some(item => item.purpose === 'compaction')).toBe(true);
  for (const item of report.measurements) {
    expect(item.estimateToActualRatio).toBe(item.estimatedInputTokens / item.promptTokens!);
  }
  expect(report.adopted).toBe(state.compactions.length);
  expect(report.reportedTokens).toBe(report.requests * 100);
  expect(report.records.every(record => record.metrics!.responseChars > 0)).toBe(true);
  const measuredRequest = [...state.turns.values()].flatMap(turn => turn.effects)
    .flatMap(entry => entry.inferenceRequests).find(request => request.result?.contextWindow && request.result.usage)!;
  const savedUsage = measuredRequest.result!.usage!;
  measuredRequest.result!.usage = { promptTokens: 0, completionTokens: 1 };
  expect(handoffReport(state).measurements.find(item => item.requestId === measuredRequest.requestId)!.estimateToActualRatio).toBeNull();
  delete measuredRequest.result!.usage;
  const missingUsage = handoffReport(state).measurements.find(item => item.requestId === measuredRequest.requestId)!;
  expect(missingUsage.promptTokens).toBeUndefined();
  expect(missingUsage.estimateToActualRatio).toBeUndefined();
  measuredRequest.result!.usage = savedUsage;
  const last = state.compactions.at(-1)!;
  for (const content of ['ok', '[NO_HANDOFF: insufficient-evidence]']) {
    const tampered = structuredClone(events);
    for (const event of tampered) {
      if (event.fact.event.type === 'inference.responded' && event.fact.event.data.requestId === last.requestId) event.fact.event.data.result.content = content;
      if (event.fact.event.type === 'context.compacted' && event.fact.event.data.requestId === last.requestId) event.fact.event.data.summary = content;
    }
    expect(() => replayAgent(agent.id, tampered)).toThrow('Invalid structured handoff');
  }
});
