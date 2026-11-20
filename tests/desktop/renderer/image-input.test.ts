import { expect, it } from 'vitest';
import { AgentInputSchema, agentInputMessage, MessageSchema } from '@archer/contracts';

it('图片输入经事实序列化后仍能完整投影，长文本不截断', () => {
  const text = '粘贴内容\n'.repeat(10000);
  const input = AgentInputSchema.parse({ content: [
    { type: 'text', text },
    { type: 'image', mediaType: 'image/png', data: 'aGVsbG8=' },
  ] });
  const replayed = AgentInputSchema.parse(JSON.parse(JSON.stringify(input)));
  expect(MessageSchema.parse(agentInputMessage(replayed))).toEqual({
    role: 'user', content: text,
    images: [{ type: 'image', mediaType: 'image/png', data: 'aGVsbG8=' }],
  });
});
it('拒绝非法图片类型、无效编码和超量附件', () => {
  for (const block of [
    { type: 'image', mediaType: 'image/svg+xml', data: 'aGVsbG8=' },
    { type: 'image', mediaType: 'image/png', data: 'http://remote' },
  ]) expect(AgentInputSchema.safeParse({ content: [block] }).success).toBe(false);
  expect(AgentInputSchema.safeParse({ content: Array(5).fill({
    type: 'image', mediaType: 'image/png', data: 'aGVsbG8=',
  }) }).success).toBe(false);
});
