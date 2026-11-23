/** 思考协议状态只回传到同一模型，不能伪造文本或挪用其他来源签名。 */
import { expect, it } from 'vitest';
import { parsePiConfig, resolvePiConfig } from '@archer/inference-pi';
import { toPiContext } from '../../packages/inference-pi/src/context';
import type { Message } from '@archer/contracts';
const model = resolvePiConfig(parsePiConfig({ providers: { deepseek: { models: [{ id: 'deepseek-flash' }] } } })).routes[0]!.models[0]!;
const message: Message = { role: 'assistant', content: 'Inspect source.', reasoning: 'First.Second.', reasoningReplay: { provider: model.provider, model: model.id, api: model.api, blocks: [{ start: 0, end: 6, signature: 'first-signature' }, { start: 6, end: 13, signature: 'second-signature', redacted: true }] } };
it('精确保留原分块的文本范围、签名和脱敏标记', () => {
  const projected = toPiContext([message], model).messages[0];
  expect(projected?.role).toBe('assistant');
  if (projected?.role !== 'assistant') throw new Error('Expected assistant');
  expect(projected.content.slice(0, 2)).toEqual([{ type: 'thinking', thinking: 'First.', thinkingSignature: 'first-signature' }, { type: 'thinking', thinking: 'Second.', thinkingSignature: 'second-signature', redacted: true }]);
});
it('切换 API、服务或模型后不回传旧思考签名', () => {
  for (const key of ['api', 'provider', 'model'] as const) {
    const changed = { ...message, reasoningReplay: { ...message.reasoningReplay!, [key]: 'other-source' } };
    const projected = toPiContext([changed], model).messages[0];
    expect(projected?.role === 'assistant' && projected.content.some(block => block.type === 'thinking')).toBe(false);
  }
});
it('回传范围超出原文时明确失败，不补造思考内容', () => {
  expect(() => toPiContext([{ ...message, reasoning: 'short' }], model)).toThrow('references missing text');
});

it('图片和文字一起传给视觉模型，文本模型明确拒绝', () => {
  const image = { type: 'image' as const, mediaType: 'image/png' as const, data: 'aGVsbG8=' };
  const messages: Message[] = [{ role: 'user', content: '解释这张图', images: [image] }];
  const visual = { ...model, input: ['text', 'image'] as ('text' | 'image')[] };
  expect(toPiContext(messages, visual).messages[0]?.content).toEqual([
    { type: 'text', text: '解释这张图' },
    { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' },
  ]);
  expect(() => toPiContext(messages, { ...model, input: ['text'] })).toThrow('不支持图片');
});
