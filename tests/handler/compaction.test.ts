/** 近期保护依据 token 体积而非消息数量，摘要只能在完整交互边界截断。 */
import { expect, it } from 'vitest';
import type { InferEffect, Message } from '@archer/contracts';
import { planCompaction, buildContext, type HandlerContext } from '@archer/handler';
const target = { providerId: 'p', capabilityId: 'm', contractId: 'archer.inference@1', revision: 'v' };
function context(): HandlerContext {
  return {
    agentId: 'a', turnId: 't', effectId: 'e', signal: new AbortController().signal, now: () => 0,
    inferenceHistory: [], effectRequests: [], compactions: [], target: null, targetError: null, isStopping: () => false,
    prepare: async () => null, executeInference: async () => { throw new Error('unexpected'); }, commitCompaction: async () => { throw new Error('unexpected'); },
    inference: {
      measure: effect => ({ contextWindow: 100_000, maxOutputTokens: 16_000, estimatedInputTokens: effect.messages.reduce((total, message) => total + message.content.length + 10, 0), method: 'test-content-units' }),
      infer: async () => ({ content: 'summary' }),
    },
  };
}
function request(messages: Message[]): InferEffect { return { type: 'INFER', target, promptPrefixCount: 0, messages }; }
it('两条长消息也能形成受保护尾部，不要求固定八条消息', () => {
  const effect = request([{ role: 'assistant', content: 'old' }, { role: 'assistant', content: 'x'.repeat(2000) }, { role: 'user', content: 'Continue.' }]);
  const plan = planCompaction(effect, context(), 1000)!;
  expect(plan.coveredMessageCount).toBe(1);
  expect(plan.request.config?.maxTokens).toBe(10_000);
});
it('摘要输出上限不随模型输出能力放大，思考与正文共用同一预算', () => {
  const ctx = context();
  ctx.inference.measure = effect => ({ contextWindow: 1_000_000, maxOutputTokens: 384_000, estimatedInputTokens: effect.messages.reduce((total, message) => total + message.content.length + 10, 0), method: 'test-content-units' });
  const effect = request([{ role: 'assistant', content: 'old' }, { role: 'assistant', content: 'x'.repeat(2000) }, { role: 'user', content: 'Continue.' }]);
  expect(planCompaction(effect, ctx, 1000)!.request.config?.maxTokens).toBe(16_384);
});
it('许多短消息不足保护目标时不能为了压缩率删除尾部', () => {
  const effect = request(Array.from({ length: 20 }, () => ({ role: 'assistant', content: 'short' })));
  expect(planCompaction(effect, context(), 1000)).toBeNull();
});
it('尾部包含工具结果时同时保留调用、参数和签名', () => {
  const effect = request([
    { role: 'assistant', content: 'older conclusion' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'call', name: 'read', input: { path: 'file' }, signature: 'signed' }] },
    { role: 'tool', toolCallId: 'call', toolName: 'read', content: 'evidence'.repeat(1000) },
    { role: 'user', content: 'Continue.' },
  ]);
  const plan = planCompaction(effect, context(), 1000)!;
  expect(plan.coveredMessageCount).toBe(1);
  const built = buildContext(effect, { effectId: 'e', requestId: 'r', coveredMessageCount: 1, summary: 'Older conclusion.' });
  expect(built.messages.slice(-3)).toEqual(effect.messages.slice(-3));
});
it('无法容纳不可拆工具批次时不截成孤立结果', () => {
  const effect = request([
    { role: 'assistant', content: '', toolCalls: [{ id: 'call', name: 'read', input: {} }] },
    { role: 'tool', toolCallId: 'call', toolName: 'read', content: 'evidence'.repeat(1000) },
    { role: 'user', content: 'Continue.' },
  ]);
  expect(planCompaction(effect, context(), 1000)).toBeNull();
});

it('大摘要段均超限时仍尝试最小合法段，不因二分跳过它', () => {
  const effect = request(Array.from({ length: 10 }, () => ({ role: 'assistant', content: 'source' })));
  const ctx = context();
  const originalMeasure = ctx.inference.measure!;
  ctx.inference.measure = input => {
    if (input.messages[0]?.role === 'system') {
      const source = JSON.parse(input.messages[1]!.content) as { messages: Message[] };
      return { ...originalMeasure(input), estimatedInputTokens: source.messages.length === 1 ? 100 : 1_000_000 };
    }
    return originalMeasure(input);
  };
  expect(planCompaction(effect, ctx, 10)?.coveredMessageCount).toBe(1);
});

it('选择可容纳的最大完整分段，避免折半跳过较大可用段', () => {
  const effect = request(Array.from({ length: 10 }, () => ({ role: 'assistant', content: 'source' })));
  const ctx = context();
  const originalMeasure = ctx.inference.measure!;
  let probes = 0;
  ctx.inference.measure = input => {
    if (input.messages[0]?.role === 'system') {
      probes++;
      const source = JSON.parse(input.messages[1]!.content) as { messages: Message[] };
      return { ...originalMeasure(input)!, estimatedInputTokens: source.messages.length <= 6 ? 100 : 1_000_000 };
    }
    return originalMeasure(input);
  };
  expect(planCompaction(effect, ctx, 10)?.coveredMessageCount).toBe(6);
  expect(probes).toBeLessThanOrEqual(4);
});
it('摘要规划期间失去计量能力时不生成未核实的摘要请求', () => {
  const effect = request(Array.from({ length: 10 }, () => ({ role: 'assistant', content: 'source' })));
  const ctx = context();
  const originalMeasure = ctx.inference.measure!;
  ctx.inference.measure = input => input.messages[0]?.role === 'system' ? undefined : originalMeasure(input);
  expect(planCompaction(effect, ctx, 10)).toBeNull();
});

it('不同近期目标下均保留完整多工具批次和所有用户原文，重复摘要只处理新增覆盖', () => {
  const messages: Message[] = [{ role: 'user', content: 'Keep the original constraint.' }];
  for (let batch = 0; batch < 12; batch++) {
    messages.push({ role: 'assistant', content: `batch ${batch}`, toolCalls: [
      { id: `a${batch}`, name: 'read', input: { path: `a${batch}` }, signature: 'signed-a' },
      { id: `b${batch}`, name: 'read', input: { path: `b${batch}` }, signature: 'signed-b' },
    ] });
    messages.push({ role: 'tool', toolCallId: `a${batch}`, content: 'a'.repeat(30 + batch * 7) });
    messages.push({ role: 'tool', toolCallId: `b${batch}`, content: 'b'.repeat(50 + batch * 11) });
    messages.push({ role: 'user', content: `Keep user input ${batch}` });
  }
  const effect = request(messages);
  for (const targetTokens of [0, 30, 100, 300, 1000]) {
    const first = planCompaction(effect, context(), targetTokens)!;
    expect(first).not.toBeNull();
    const summary = { effectId: 'e', requestId: 'r', coveredMessageCount: first.coveredMessageCount, summary: 'Previous findings.' };
    const built = buildContext(effect, summary);
    expect(built.messages.filter(message => message.role === 'user' && !message.content.startsWith('Conversation summary'))).toEqual(messages.filter(message => message.role === 'user'));
    expect(built.messages.slice(-messages.slice(first.coveredMessageCount).length)).toEqual(messages.slice(first.coveredMessageCount));
    const pending = new Set<string>();
    for (const message of built.messages) {
      for (const call of message.toolCalls ?? []) pending.add(call.id);
      if (message.role === 'tool') expect(pending.delete(message.toolCallId!)).toBe(true);
    }
    expect(pending.size).toBe(0);
    const previous = { ...summary, coveredMessageCount: 4 };
    const next = planCompaction(effect, context(), targetTokens, previous)!;
    expect(next).not.toBeNull();
    expect(next.coveredMessageCount).toBeGreaterThan(previous.coveredMessageCount);
    expect(JSON.parse(next.request.messages[1]!.content)).toEqual({ previousSummary: previous.summary, sourceStart: previous.coveredMessageCount, messages: messages.slice(previous.coveredMessageCount, next.coveredMessageCount) });
  }
});

it('规划计量包含本次准备参考与已提交状态参考，保留的用户原文不冒充近期工具体积', () => {
  const effect = request([
    { role: 'user', content: 'user constraint'.repeat(100) },
    { role: 'assistant', content: 'old evidence' },
    { role: 'assistant', content: 'x'.repeat(2000) },
    { role: 'user', content: 'Continue.' },
  ]);
  const prepared = {
    ...effect,
    promptPrefixCount: 2,
    messages: [
      { role: 'user' as const, content: 'project reference' },
      { role: 'user' as const, content: 'committed execution reference' },
      ...effect.messages,
    ],
  };
  const ctx = context();
  const measured: InferEffect[] = [];
  const measure = ctx.inference.measure!;
  ctx.inference.measure = input => {
    measured.push(input);
    return measure(input);
  };
  const plan = planCompaction(effect, ctx, 1000, undefined, prepared)!;
  expect(plan.coveredMessageCount).toBe(2);
  const probes = measured.filter(input => input.messages[0]?.content === 'project reference');
  expect(probes.length).toBeGreaterThan(2);
  expect(probes.every(input => input.messages[1]?.content === 'committed execution reference')).toBe(true);
  expect(JSON.parse(plan.request.messages[1]!.content).messages).toEqual(effect.messages.slice(0, 2));
});
