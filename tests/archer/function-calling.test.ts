/** 模型名称只映射到已提交的 Provider 引用；调用通过 Runtime 事实边界。 */
import { afterEach, expect, it } from 'vitest';
import type { Archer, Inference, JsonValue } from '@archer/contracts';
import { OperationRejected } from '@archer/contracts';
import { createArcher } from '@archer/runtime';
import { provider, tool, skill } from '@archer/camp';
import { MemoryAgentJournal } from '@archer/storage';
import { testCamp } from '../helpers/application';
import { toolReply } from '../helpers/inference';
const running: Archer[] = [];
afterEach(async () => { for (const app of running.splice(0)) await app.stop(); });
async function fixture(inference: Inference, invoke: (input: JsonValue) => JsonValue | Promise<JsonValue>, metadata = {}) {
  const journal = new MemoryAgentJournal();
  const app = createArcher({ camp: testCamp({ journal, inference, builtins: false, providers: [provider('test', { run: tool({ description: 'Run.', inputSchema: { type: 'object' }, execution: 'write', invoke, ...metadata }) })] }) });
  running.push(app); await app.start();
  return { app, journal, agent: await app.agents.create({ id: 'test', instructions: 'Use the tool.' }) };
}
it('先提交意图和 started，调用一次，工具结果配对后继续推理', async () => {
  let calls = 0;
  const f = await fixture({ infer: async effect => {
    const result = effect.messages.find(message => message.role === 'tool');
    if (result) { expect(result).toMatchObject({ content: '{"saved":true}', toolCallId: expect.any(String) }); return { content: 'Saved.' }; }
    expect(effect.messages.map(message => message.content).join('\n')).not.toContain('contractId');
    return toolReply(effect, 'test.run', { content: 'hello' });
  } }, async () => {
    const events = await f.journal.read('test');
    expect(events.at(-1)!.fact.event.type).toBe('effect.started'); calls++; return { saved: true };
  });
  await f.agent.prompt('Save.'); expect(calls).toBe(1);
  expect((await f.agent.getState()).messages.at(-1)?.content).toBe('Saved.');
  const created = (await f.agent.events()).filter(item => item.fact.scope === 'turn' && item.fact.event.type === 'effect.created');
  expect(JSON.stringify(created)).toContain('providerId');
});
it('阶段正文伴随工具调用时继续执行，并保留到后续推理和消息事实', async () => {
  let calls = 0;
  let inferences = 0;
  const progress = '已定位关键入口，接下来验证返回结果。';
  const f = await fixture({ infer: async effect => {
    inferences++;
    if (effect.messages.at(-1)?.role === 'tool') {
      // 后续推理必须能读到原阶段正文，不能只保留工具请求而丢失沟通事实。
      expect(effect.messages.some(message => message.role === 'assistant'
        && message.content === progress && message.toolCalls?.length === 1)).toBe(true);
      return { content: '验证完成。' };
    }
    return { ...toolReply(effect, 'test.run'), content: progress };
  } }, () => {
    calls++;
    return 'ok';
  });
  await f.agent.prompt('检查并验证。');
  expect(calls).toBe(1);
  expect(inferences).toBe(2);
  const messages = (await f.agent.getState()).messages.filter(message => message.role === 'assistant');
  expect(messages.map(message => message.content)).toEqual([progress, '验证完成。']);
});

it('新 Turn 直接取得完整工具声明，不需要模型先发现能力', async () => {
  const names: string[] = []; let calls = 0;
  const f = await fixture({ infer: async effect => {
    names.push(effect.tools![0]!.name);
    const last = effect.messages.at(-1)!;
    return last.role === 'tool' ? { content: 'Done.' } : toolReply(effect, 'test.run');
  } }, () => { calls++; return 'ok'; });
  await f.agent.prompt('One.'); await f.agent.prompt('Two.');
  expect(calls).toBe(2); expect(new Set(names).size).toBe(1);
});
it('非对象输入以原生对象包装，Runtime 解包后调用真实接口', async () => {
  const received: JsonValue[] = [];
  const f = await fixture({ infer: async effect => effect.messages.at(-1)?.role === 'tool' ? { content: 'Done.' } : toolReply(effect, 'test.run', { input: 'query' }) }, input => { received.push(input); return 'ok'; }, { inputSchema: { type: 'string' }, execution: 'read' });
  await f.agent.prompt('Search.'); expect(received).toEqual(['query']);
});
it('非法模型工具名不会触发 Provider，连续非法响应明确结束', async () => {
  let calls = 0;
  const f = await fixture({ infer: async () => ({ content: '', toolCalls: [{ id: 'bad', name: 'invented', input: {} }] }) }, () => { calls++; return null; });
  await expect(f.agent.prompt('Run.')).rejects.toMatchObject({ code: 'TURN_FAILED' }); expect(calls).toBe(0);
});
it.each(['read', 'write'] as const)('%s 异常按真实执行语义归类', async execution => {
  const f = await fixture({ infer: async effect => effect.messages.at(-1)?.role === 'tool' ? { content: 'Failed.' } : toolReply(effect, 'test.run') }, () => { throw new Error('Connection lost'); }, { execution });
  const turn = await f.agent.send('Run.');
  if (execution === 'write') {
    await expect.poll(async () => (await f.agent.getState()).activeTurn?.pending?.kind).toBe('reconcile');
    expect((await f.agent.turns.events(turn.turnId)).some(event => event.type === 'effect.unknown')).toBe(true);
  } else { await f.agent.wait(turn.turnId); expect((await f.agent.turns.events(turn.turnId)).some(event => event.type === 'effect.failed')).toBe(true); }
});
it('写入前明确拒绝不会进入未知写入', async () => {
  const f = await fixture({ infer: async effect => effect.messages.at(-1)?.role === 'tool' ? { content: 'Rejected.' } : toolReply(effect, 'test.run') }, () => { throw new OperationRejected('Rejected.'); });
  await f.agent.prompt('Run.'); const events = await f.agent.events();
  expect(events.some(event => event.fact.event.type === 'effect.unknown')).toBe(false);
});
it('Skill 独立 load，模型主动加载的正文进入已提交结果和工具消息', async () => {
  let loads = 0;
  const app = createArcher({ camp: testCamp({ builtins: false, providers: [provider('git', { review: skill({ name: 'review', description: 'Review changes.', load: async () => { loads++; return { content: 'Check correctness.', revision: 'skill-1' }; } }) })],
    inference: { infer: async effect => {
      if (effect.messages.at(-1)?.role === 'tool') { expect(effect.messages.at(-1)?.content).toContain('Check correctness.'); return { content: 'Reviewed.' }; }
      expect(loads).toBe(0); return toolReply(effect, 'git.review');
    } },
  }) }); running.push(app); await app.start();
  const agent = await app.agents.create({ id: 'skill', instructions: 'Review.' }); await agent.prompt('Review.'); expect(loads).toBe(1);
  const events = await agent.events();
  expect(events.some(item => item.fact.scope === 'turn' && item.fact.event.type === 'effect.created' && item.fact.event.data.effect.type === 'CALL' && item.fact.event.data.effect.target.contractId === 'archer.skill@1')).toBe(true);
});

it.each([false, true])('截断响应不作为答复或执行计划，含工具调用：%s', async withCall => {
  let calls = 0;
  const f = await fixture({ infer: async effect => ({ content: 'Incomplete answer', stopReason: 'length', ...(withCall ? { toolCalls: toolReply(effect, 'test.run').toolCalls } : {}) }) }, () => { calls++; return 'written'; });
  await expect(f.agent.prompt('Run.')).rejects.toMatchObject({ code: 'TURN_FAILED' });
  expect(calls).toBe(0);
  const events = await f.agent.events();
  expect(events.some(item => item.fact.scope === 'turn' && item.fact.event.type === 'turn.completed')).toBe(false);
  expect(events.some(item => item.fact.scope === 'turn' && item.fact.event.type === 'turn.failed' && item.fact.event.data.error.code === 'MODEL_OUTPUT_TRUNCATED')).toBe(true);
  expect(JSON.stringify(events)).toContain('"stopReason":"length"');
  expect((await f.agent.getState()).messages.some(message => message.role === 'assistant' && message.content === 'Incomplete answer')).toBe(false);
});
it('首次空回复允许继续，两次连续空回复明确失败且不无限推理', async () => {
  let steps = 0;
  const f = await fixture({ infer: async effect => {
    steps++;
    if (steps === 2) expect(effect.messages.at(-1)?.content).toContain('No answer or tool call was returned');
    return { content: '  ', stopReason: 'stop' };
  } }, async () => null);
  await expect(f.agent.prompt('Answer.')).rejects.toMatchObject({ code: 'TURN_FAILED' });
  expect(steps).toBe(2);
  expect(JSON.stringify(await f.agent.events())).toContain('MODEL_EMPTY_RESPONSE');
});
it('空回复后的有效答复可以完成，toolUse 缺少调用不能冒充完成', async () => {
  let steps = 0;
  const recovered = await fixture({ infer: async () => ++steps === 1 ? { content: '' } : { content: 'Recovered answer.', stopReason: 'stop' } }, async () => null);
  await recovered.agent.prompt('Answer.'); expect((await recovered.agent.getState()).messages.at(-1)?.content).toBe('Recovered answer.');
  const malformed = await fixture({ infer: async () => ({ content: 'I will use a tool.', stopReason: 'toolUse' }) }, async () => null);
  await expect(malformed.agent.prompt('Run.')).rejects.toMatchObject({ code: 'TURN_FAILED' });
  expect(JSON.stringify(await malformed.agent.events())).toContain('MODEL_TOOL_CALL_MISSING');
});
it('未知工具反馈当次准确名称，模型纠正后继续执行', async () => {
  let steps = 0;
  let invocations = 0;
  const f = await fixture({ infer: async effect => {
    steps++;
    if (steps === 1) return { content: '', toolCalls: [{ id: 'unknown', name: 'bash', input: {} }] };
    if (steps === 2) {
      const feedback = effect.messages.at(-1)!;
      expect(feedback).toMatchObject({ role: 'tool', isError: true });
      expect(feedback.content).toContain('unknown tool "bash"');
      expect(feedback.content).toContain(`Available function names for this request: ${JSON.stringify((effect.tools ?? []).map(tool => tool.name))}`);
      return toolReply(effect, 'test.run');
    }
    return { content: 'Recovered.' };
  } }, async () => { invocations++; return 'saved'; });
  await f.agent.prompt('Run.');
  expect(invocations).toBe(1);
  expect((await f.agent.getState()).messages.at(-1)?.content).toBe('Recovered.');
});
it('混合批次执行合法调用，非法调用单独反馈，原生结果逐一配对', async () => {
  let invocations = 0;
  const f = await fixture({ infer: async effect => {
    if (effect.messages.at(-1)?.role === 'tool') {
      const results = effect.messages.filter(message => message.role === 'tool');
      expect(results).toHaveLength(2);
      expect(results.find(message => message.toolCallId === 'bad')).toMatchObject({ isError: true, content: expect.stringContaining('unknown tool') });
      expect(results.find(message => message.toolCallId !== 'bad')?.content).toBe('"saved"');
      return { content: 'Done.' };
    }
    const valid = toolReply(effect, 'test.run'); valid.toolCalls!.push({ id: 'bad', name: 'invented', input: {} }); return valid;
  } }, async () => { invocations++; return 'saved'; });
  await f.agent.prompt('Run.'); expect(invocations).toBe(1);
});
it('重复 ID 的批次不执行任何调用，不能构造无法配对的原生历史', async () => {
  let steps = 0; let invocations = 0;
  const f = await fixture({ infer: async effect => {
    if (steps++ > 0) { expect(effect.messages.some(message => message.role === 'tool')).toBe(false); return { content: 'Corrected.' }; }
    const result = toolReply(effect, 'test.run'); result.toolCalls!.push({ ...result.toolCalls![0]! }); return result;
  } }, async () => { invocations++; return null; });
  await f.agent.prompt('Run.'); expect(invocations).toBe(0);
});
it('工具明确拒绝的错误码和详细信息进入模型反馈，可用于下一步修正', async () => {
  let attempts = 0;
  const f = await fixture({ infer: async effect => {
    const last = effect.messages.at(-1)!;
    if (last.role === 'tool' && last.isError) {
      expect(JSON.parse(last.content)).toMatchObject({ outcome: 'failed', error: { code: 'REVISION_CONFLICT', message: 'Read the current revision.' } });
      return { content: 'The file changed; a fresh read is required.' };
    }
    return toolReply(effect, 'test.run');
  } }, () => { attempts++; throw new OperationRejected('Read the current revision.', 'REVISION_CONFLICT'); });
  await f.agent.prompt('Edit.'); expect(attempts).toBe(1);
});

it('工具轮次的原始思考和签名进入消息事实，后续推理可从历史还原', async () => {
  const replay = { api: 'openai-completions', provider: 'example', model: 'm', blocks: [{ start: 0, end: 8, signature: 'provider-signature' }] };
  let step = 0;
  const f = await fixture({ infer: async effect => {
    if (step++ === 0) return { ...toolReply(effect, 'test.run'), reasoning: 'Observed', reasoningReplay: replay };
    expect(effect.messages.find(message => message.role === 'assistant' && message.toolCalls?.length)).toMatchObject({ reasoning: 'Observed', reasoningReplay: replay });
    return { content: 'Done.' };
  } }, async () => 'result');
  await f.agent.prompt('Investigate.');
  const events = await f.agent.events();
  expect(events.some(event => event.fact.scope === 'turn' && event.fact.event.type === 'message.appended' && event.fact.event.data.message.reasoningReplay?.blocks[0]?.signature === 'provider-signature')).toBe(true);
});

it.each([100, 99])('累计用量达到或超过预算 %i 后不发起下一次推理，已计划的调用只执行一次', async budget => {
  let inferences = 0; let calls = 0;
  const f = await fixture({ infer: async effect => { inferences++; return { ...toolReply(effect, 'test.run'), usage: { promptTokens: 90, completionTokens: 10, cacheReadTokens: 80 } }; } }, () => { calls++; return 'saved'; });
  const turn = await f.agent.send('Run.', { limits: { tokenBudget: budget } });
  await expect(f.agent.wait(turn.turnId)).rejects.toMatchObject({ code: 'TURN_FAILED' });
  expect(inferences).toBe(1); expect(calls).toBe(1);
  expect((await f.agent.turns.events(turn.turnId)).at(-1)).toMatchObject({ type: 'turn.failed', data: { error: { code: 'TOKEN_BUDGET_EXCEEDED' } } });
  const messages = (await f.agent.getState()).messages;
  expect(messages.filter(message => message.role === 'tool')).toHaveLength(1);
});
it('预算内可继续推理，缓存不重复累加，已得到最终答复允许完成', async () => {
  let inferences = 0;
  const f = await fixture({ infer: async effect => ({ ...(inferences++ === 0 ? toolReply(effect, 'test.run') : { content: 'Done.' }), usage: { promptTokens: 90, completionTokens: 10, cacheReadTokens: 80 } }) }, () => 'ok');
  await f.agent.prompt('Run.', { limits: { tokenBudget: 101 } });
  expect(inferences).toBe(2);
});
it('显式预算遇到缺失用量时停止，未配置预算仍按原行为执行', async () => {
  let inferences = 0;
  const f = await fixture({ infer: async effect => { inferences++; return effect.messages.at(-1)?.role === 'tool' ? { content: 'Done.' } : toolReply(effect, 'test.run'); } }, () => 'ok');
  const turn = await f.agent.send('Run.', { limits: { tokenBudget: 100 } });
  await expect(f.agent.wait(turn.turnId)).rejects.toMatchObject({ code: 'TURN_FAILED' });
  expect(inferences).toBe(1);
  expect((await f.agent.turns.events(turn.turnId)).at(-1)).toMatchObject({ type: 'turn.failed', data: { error: { code: 'TOKEN_USAGE_UNAVAILABLE' } } });
  await f.app.agents.resumeQueue(f.agent.id);
  await f.agent.prompt('Run without a budget.');
  expect(inferences).toBe(3);
});
