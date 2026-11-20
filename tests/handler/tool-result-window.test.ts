/** 请求节选必须可重读且不篡改事实、调用协议或 Unicode。 */
import { expect, it } from 'vitest';
import type { InferEffect } from '@archer/contracts';
import type { HandlerContext } from '@archer/handler';
import { boundToolResults } from '../../packages/handler/src/tool-result-window.js';

const target = { providerId: 'model', capabilityId: 'infer', contractId: 'archer.inference@1', revision: 'v1' };
const content = '😀evidence'.repeat(10_000);
const effect: InferEffect = {
  type: 'INFER', target, promptPrefixCount: 1,
  messages: [
    { role: 'system', content: 'Fixed policy.' },
    { role: 'user', content: 'Keep constraints.' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'call', name: 'source', input: { path: 'file' }, signature: 'signed' }] },
    { role: 'tool', toolCallId: 'call', toolName: 'source', content, isError: true },
  ],
  tools: [{ name: 'actual_history_tool', target: { ...target, providerId: 'history', capabilityId: 'read' }, description: 'Read history.', parameters: {} }],
};
function context(): HandlerContext {
  return {
    agentId: 'a', turnId: 't', effectId: 'e', now: () => 0, signal: new AbortController().signal,
    target: null, targetError: null, isStopping: () => false, prepare: async () => null,
    inferenceHistory: [], effectRequests: [], compactions: [],
    executeInference: async () => { throw new Error('Unexpected request'); },
    commitCompaction: async () => { throw new Error('Unexpected adoption'); },
    inference: {
      infer: async () => ({ content: 'Done.' }),
      measure: request => ({ contextWindow: 10_000, maxOutputTokens: 1000,
        estimatedInputTokens: JSON.stringify(request.messages).length, method: 'test-characters' }),
    },
    history: { list: () => ({ calls: [] }), read: () => ({ turnId: 'original-turn', callId: 'call', content: '😀', totalChars: content.length, offset: 0, isError: true }) },
  };
}

it('节选使用实际工具名与精确来源，不改变用户约束、签名、配对与业务错误', () => {
  const source = structuredClone(effect);
  const ctx = context();
  const result = boundToolResults(effect, ctx);
  expect(effect).toEqual(source);
  expect(result.messages.slice(0, 3)).toEqual(effect.messages.slice(0, 3));
  expect(result.messages[3]).toMatchObject({ role: 'tool', toolCallId: 'call', toolName: 'source', isError: true });
  expect(result.messages[3]!.content).toContain('actual_history_tool');
  expect(result.messages[3]!.content).toContain('"turnId":"original-turn"');
  const excerpt = result.messages[3]!.content.split('\n[Tool output excerpt;')[0]!;
  expect(content.startsWith(excerpt)).toBe(true);
  expect(excerpt.endsWith('\uD83D')).toBe(false);
  expect(ctx.inference.measure!(result)!.estimatedInputTokens).toBeLessThan(8800);
});

it('窗口足够、没有历史工具、来源歧义或缺少计量时保留原文，由最终准入处理', () => {
  const ctx = context();
  expect(boundToolResults({ ...effect, tools: [] }, ctx).messages).toEqual(effect.messages);
  expect(boundToolResults(effect, { ...ctx, history: undefined })).toBe(effect);
  expect(boundToolResults(effect, { ...ctx, history: { list: () => ({ calls: [] }), read: () => { throw new Error('Ambiguous'); } } })).toBe(effect);
  expect(boundToolResults(effect, { ...ctx, inference: { infer: ctx.inference.infer } })).toBe(effect);
  const small = { ...effect, messages: effect.messages.map(message => message.role === 'tool' ? { ...message, content: 'Small output.' } : message) };
  expect(boundToolResults(small, ctx)).toBe(small);
});

it('节选收益按完整输入计算，低于配置门槛时保留原文', () => {
  const ctx = context();
  const output = 'x'.repeat(2600);
  const source: InferEffect = {
    ...effect,
    promptPrefixCount: 0,
    messages: [
      { role: 'user', content: 'u'.repeat(6500) },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call', name: 'source', input: {} }] },
      { role: 'tool', toolCallId: 'call', content: output },
    ],
  };
  ctx.history = { read: () => ({ turnId: 't', callId: 'call', content: 'xx', totalChars: output.length, offset: 0 }) };
  expect(boundToolResults(source, ctx, 0.25)).toBe(source);
  const accepted = boundToolResults(source, ctx, 0.05);
  const before = ctx.inference.measure!(source)!.estimatedInputTokens;
  const after = ctx.inference.measure!(accepted)!.estimatedInputTokens;
  expect((before - after) / before).toBeGreaterThanOrEqual(0.05);
  expect((before - after) / before).toBeLessThan(0.25);
  expect(accepted.messages.at(-1)!.content).toContain('Tool output excerpt');
});


it('容量线内提前节选可重读大结果，低占用保持原文', () => {
  const ctx = context();
  const originalMeasure = ctx.inference.measure!;
  ctx.inference = {
    ...ctx.inference,
    measure: request => ({ ...originalMeasure(request)!, contextWindow: 120_000, maxOutputTokens: 1000 }),
  };
  const before = ctx.inference.measure!(effect)!.estimatedInputTokens;
  expect(before).toBeLessThan(116_600);
  expect(before).toBeGreaterThan(116_600 * 0.85);
  const result = boundToolResults(effect, ctx);
  expect(result).not.toBe(effect);
  expect(result.messages[3]!.content).toContain('Tool output excerpt');
  expect(result.messages.slice(0, 3)).toEqual(effect.messages.slice(0, 3));
  ctx.inference = {
    ...ctx.inference,
    measure: request => ({ ...originalMeasure(request)!, contextWindow: 200_000, maxOutputTokens: 1000 }),
  };
  expect(boundToolResults(effect, ctx)).toBe(effect);
});
