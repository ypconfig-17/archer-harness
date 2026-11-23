/**
 * 模型可见文本测试：Prompt Frame、协议示例与观察外壳。
 */

import { describe, expect, it } from 'vitest';
import {
  ENVIRONMENT_MODEL,
  NO_WORKSPACE_TEXT,
  FUNCTION_CALL_PROTOCOL,
  EXECUTION_CONTEXT_HEADING,
  compileTurnPrompt,
  formatObservation,
  formatObservationCancelled,
  formatObservationError,
} from '@archer/agent';

describe('observation', () => {
  it('使用固定前缀与方括号标签', () => {
    expect(formatObservation('inspect /env/fs', 'hello')).toBe(
      '[System observation]\n[inspect /env/fs]\nhello',
    );
  });

  it('错误与取消有稳定的英文前缀', () => {
    expect(formatObservationError('boom')).toBe('Error: boom');
    expect(formatObservationCancelled('timeout')).toBe('Cancelled: timeout');
  });
});

describe('compileTurnPrompt', () => {
  const frame = compileTurnPrompt({
    instructions: 'Review the visible notes.',
    workspace: { cwd: '/project', access: 'read' },
  });

  it('产出固定两条消息：可信 system 与独立 user 参考', () => {
    expect(frame.prefix).toHaveLength(2);
    expect(frame.prefix.map((message) => message.role)).toEqual(['system', 'user']);
    expect(frame.prefix[0]?.content).toContain('## Agent instructions');
    expect(frame.prefix[0]?.content).toContain('Review the visible notes.');
    expect(frame.prefix[0]?.content).toContain(FUNCTION_CALL_PROTOCOL);
    expect(frame.prefix[1]?.content.startsWith(EXECUTION_CONTEXT_HEADING)).toBe(true);
    expect(frame.prefix[1]?.content).toContain('/project');
    expect(frame.prefix[1]?.content).not.toContain('providerId');
  });

  it('内部能力概念不进入模型前缀', () => {
    const system = frame.prefix[0]!.content;
    expect(system).not.toContain('### /notes');
    expect(system).not.toContain('Notes');
    expect(system).not.toContain('providerId');
    expect(system).not.toContain('/project');
  });

  it('无工作环境时明确说明文件工具不可用', () => {
    const empty = compileTurnPrompt({
      instructions: 'Answer.',
      });
    expect(empty.prefix).toHaveLength(2);
    expect(empty.prefix[1]?.content).toContain(NO_WORKSPACE_TEXT);
  });

  it('相同输入产生完全相同的 Frame', () => {
    const second = compileTurnPrompt({
      instructions: 'Review the visible notes.',
      workspace: { cwd: '/project', access: 'read' },
      });
    expect(second).toEqual(frame);
  });

  it('固定提示词与协议只包含英文', () => {
    expect(ENVIRONMENT_MODEL).not.toMatch(/[\u4e00-\u9fff]/u);
    expect(FUNCTION_CALL_PROTOCOL).not.toMatch(/[\u4e00-\u9fff]/u);
  });
});

describe('原生工具协议', () => {
  it('自然语言作为回复，执行意图由原生工具请求表达', () => {
    expect(FUNCTION_CALL_PROTOCOL).toContain('Do not emit JSON action plans');
    expect(FUNCTION_CALL_PROTOCOL).toContain('unknown');
    expect(FUNCTION_CALL_PROTOCOL).not.toContain('providerId');
    expect(FUNCTION_CALL_PROTOCOL).not.toContain('describe');
    expect(FUNCTION_CALL_PROTOCOL).toContain('Use only function names provided');
  });
});
