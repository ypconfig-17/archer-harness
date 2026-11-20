/** 模型工具消息保留完整正文，只使用显式投影声明。 */
import { expect, it } from 'vitest';
import { toolResultContent } from '../../packages/agent/src/prompt/tool-result.js';

it('只有显式模型正文才替代通用 JSON，不猜测第三方 output 字段', () => {
  const value = { output: 'done', metadata: { important: 'retain this' } };
  expect(toolResultContent({ value })).toBe(JSON.stringify(value));
  expect(toolResultContent({ value, modelContent: 'done' })).toBe('done');
  expect(toolResultContent({ value, modelContent: '' })).toBe('');
});

it('长正文与多字节内容完整保留，不在入历史前固定截断', () => {
  const text = 'BEGIN\n' + '内容😀'.repeat(20_000) + '\nEND exitCode=7';
  expect(toolResultContent({ value: { output: text }, modelContent: text })).toBe(text);
  expect(toolResultContent({ value: { output: text } })).toBe(JSON.stringify({ output: text }));
});
