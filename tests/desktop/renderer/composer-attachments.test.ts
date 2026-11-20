/** 附件事实自包含，图片与文本恢复时均不读取原始路径。 */
import { expect, it } from 'vitest';
import { AgentInputSchema, agentInputMessage, agentInputText } from '../../../packages/contracts/src/agent-session';
import { composerInput } from '../../../apps/desktop/renderer/src/lib/composer-input';

const png = { type: 'file' as const, mediaType: 'image/png', filename: 'shot.png', url: 'data:image/png;base64,aGVsbG8=' };

it('纯文本保持字符串，图片保持独立内容块', () => {
  expect(composerInput('继续任务', [])).toBe('继续任务');
  expect(composerInput('', [png])).toEqual({ content: [{ type: 'image', mediaType: 'image/png', data: 'aGVsbG8=' }] });
});

it('文本文件保留名称和完整内容，模型读正文而会话只显示附件名称', () => {
  const text = '你好\nconst value = 1;';
  const data = Buffer.from(text).toString('base64');
  const input = composerInput('检查附件', [{ type: 'file', mediaType: 'text/plain', filename: '代码.txt', url: `data:text/plain;base64,${data}` }]);
  expect(AgentInputSchema.parse(input)).toEqual(input);
  expect(agentInputText(input)).toBe('检查附件\n[附件：代码.txt]');
  expect(agentInputMessage(input).content).toContain(JSON.stringify(text));
  expect(agentInputMessage(JSON.parse(JSON.stringify(input)))).toEqual(agentInputMessage(input));
});

it('二进制、无效 UTF-8、超限和未完成转换明确拒绝', () => {
  const file = (mediaType: string, data: string) => ({ type: 'file' as const, mediaType, filename: 'test.txt', url: `data:${mediaType};base64,${data}` });
  expect(() => composerInput('', [file('application/pdf', 'JVBERi0=')])).toThrow();
  expect(() => composerInput('', [file('text/plain', '/w==')])).toThrow();
  expect(() => composerInput('', [file('text/plain', 'AA==')])).toThrow();
  expect(() => composerInput('', [file('text/plain', Buffer.alloc(256 * 1024 + 1, 65).toString('base64'))])).toThrow();
  expect(() => composerInput('', [{ ...png, url: 'blob:pending' }])).toThrow();
});


it('长文本粘贴按字符或行数收为附件，短文本保持编辑', async () => {
  const { shouldAttachPastedText } = await import('../../../packages/ui/src/ai/prompt-input-files');
  expect(shouldAttachPastedText('')).toBe(false);
  expect(shouldAttachPastedText('a'.repeat(3999))).toBe(false);
  expect(shouldAttachPastedText('a'.repeat(4000))).toBe(true);
  expect(shouldAttachPastedText(Array(79).fill('line').join('\n'))).toBe(false);
  expect(shouldAttachPastedText(Array(80).fill('line').join('\n'))).toBe(true);
});
