/** Markdown 摘要校验测试：拒绝空回复、敷衍短句、超长输出与无可用交接标记。 */
import { describe, expect, it } from 'vitest';
import { ContextHandoffUnavailable, validateContextHandoff, type Message } from '@archer/contracts';
import { validateCompaction } from '@archer/handler';

const source: Message[] = [
  { role: 'user', content: 'Update config' },
  { role: 'tool', toolCallId: 'c1', toolName: 'check', isError: true, content: 'error: missing symbol' },
];

describe('validateContextHandoff', () => {
  it('接受结构化的 Markdown 交接摘要并裁剪首尾空白', () => {
    const markdown = '\n## Goal\nUpdate config.\n\n## Progress\n- [x] Checked error.\n';
    expect(validateContextHandoff(markdown, source)).toBe(markdown.trim());
  });

  it('拒绝空内容、超长内容或无实质内容的敷衍短句', () => {
    expect(() => validateContextHandoff('   ', source)).toThrow('Empty handoff');
    expect(() => validateContextHandoff('ok', source)).toThrow('lacks structured summary');
    expect(() => validateContextHandoff(`## Goal\n${'x'.repeat(16_400)}`, source)).toThrow('exceeds size limit');
  });

  it('识别显式无可用交接标记并抛出 ContextHandoffUnavailable', () => {
    expect(() => validateContextHandoff('[NO_HANDOFF: no-useful-information]', source)).toThrow(ContextHandoffUnavailable);
    expect(() => validateCompaction({ content: '[NO_HANDOFF: insufficient-evidence]' }, source)).toThrow('No usable handoff');
    expect(() => validateCompaction({ content: JSON.stringify({ version: 2, kind: 'no-handoff', reason: 'insufficient-evidence' }) }, source)).toThrow('No usable handoff');
  });
});
