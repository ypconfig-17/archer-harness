/** 授权展示不推断真实目录，也不把批准扩展为后续命令的许可。 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import type { TurnSnapshot } from '@archer/contracts';
import type { TimelineEvent } from '../../../apps/desktop/renderer/src/lib/conversation';
vi.mock('../../../apps/desktop/renderer/src/lib/api', () => ({ client: {} }));
import { PendingInteraction } from '../../../apps/desktop/renderer/src/ui/workspace/PendingInteraction';

function render(cwd?: string) {
  const query = new QueryClient();
  const turn = { turnId: 't', pending: { kind: 'human', purpose: 'command', effectId: 'e', reason: 'Run command' } } as TurnSnapshot;
  const command = 'grep -rn "@Test" src/test | wc -l';
  const events = [{ seq: 1, fact: { scope: 'turn', turnId: 't', event: { type: 'effect.created', data: {
    effectId: 'e', effect: { type: 'CALL', target: { providerId: 'shell', capabilityId: 'bash', contractId: 'archer.tool@1', revision: 'v1' }, input: { command, ...(cwd ? { cwd } : {}) } },
  } } } }] as TimelineEvent[];
  try {
    return renderToStaticMarkup(createElement(QueryClientProvider, { client: query },
      createElement(PendingInteraction, { agentId: 'a', turn, events, workspacePath: '/workspace' })));
  } finally { query.clear(); }
}
it('命令完整保留，目录参数与当前工作区区分，操作文案明确仅本次执行', () => {
  const explicit = render('/custom');
  expect(explicit).toContain('命令目录（参数）');
  expect(explicit).toContain('/custom');
  expect(explicit).not.toContain('/workspace');
  expect(explicit).toContain('grep -rn &quot;@Test&quot; src/test | wc -l');
  expect(explicit).toContain('允许本次执行');
  expect(explicit).toContain('拒绝并结束任务');
  expect(explicit).toContain('不扩大工作区或后续命令权限');
  const implicit = render();
  expect(implicit).toContain('当前工作区');
  expect(implicit).toContain('/workspace');
  expect(implicit).toContain('由宿主工作环境解析');
});

it('任务已结束时旧 pending 不再显示可操作表单，取消请求仍保留未知结果入口', () => {
  const query = new QueryClient();
  const pending = { kind: 'reconcile', effectId: 'e', target: { providerId: 'shell', capabilityId: 'bash', contractId: 'archer.tool@1', revision: 'v1' } };
  const html = (status: string, ended = false) => renderToStaticMarkup(createElement(QueryClientProvider, { client: query },
    createElement(PendingInteraction, {
      agentId: 'a',
      turn: { turnId: 't', status, pending } as TurnSnapshot,
      events: ended ? [{ fact: { scope: 'turn', turnId: 't', event: { type: 'turn.cancelled' } } }] as TimelineEvent[] : [],
    })));
  try {
    expect(html('cancelled')).toBe('');
    expect(html('waiting', true)).toBe('');
    expect(html('cancelling')).toContain('外部操作结果未知');
    expect(html('cancelling')).toContain('明确重试原操作');
  } finally { query.clear(); }
});

it('人工确认使用单选项语义与继续含义，不把选择伪装成已提交答案', () => {
  const query = new QueryClient();
  const turn = { turnId: 't', pending: {
    kind: 'human', effectId: 'e', reason: '请选择冲突处理方式', options: ['优先用户目录', '合并两个 Skill'],
  } } as TurnSnapshot;
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: query },
    createElement(PendingInteraction, { agentId: 'a', turn, events: [] })));
  try {
    expect(html).toContain('需要你的确认');
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('确认并继续');
    expect(html).not.toContain('已回答');
  } finally { query.clear(); }
});
