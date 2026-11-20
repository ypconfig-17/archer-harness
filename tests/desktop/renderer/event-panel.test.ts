// @vitest-environment jsdom
/** 任务折叠保留完整事实和原始编号，异常入口不替代原始事件阅读。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentEvent, Snapshot } from '@archer/contracts';
import { afterEach, expect, it } from 'vitest';
import { eventNavigation } from '../../../apps/desktop/renderer/src/lib/event-navigation';
import { EventPanel, EventRecordDetail } from '../../../apps/desktop/renderer/src/ui/panels/EventPanel';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()));
  document.body.replaceChildren();
});

/** 先主动打开事件页，验证可见行为，不依赖隐藏页提前生成 DOM。 */
function renderEvents(events: Snapshot<AgentEvent>[], hasEarlier = false) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(EventPanel, { events, hasEarlier })));
  const button = [...container.querySelectorAll('button')].find(button => button.textContent === '全部事件')!;
  act(() => button.click());
  return container.innerHTML;
}

function event(seq: number, turnId: string): Snapshot<AgentEvent> {
  return {
    id: `a:${seq}`,
    agentId: 'a',
    seq,
    ts: seq,
    fact: {
      scope: 'turn',
      turnId,
      turnSeq: seq,
      event: { type: 'turn.completed', data: { completedAt: seq, stopReason: 'respond' } },
    },
  } as Snapshot<AgentEvent>;
}

it('同任务事实可折叠，每条原始 JSON 和编号仍可访问', () => {
  const html = renderEvents([event(1, 'a:t1'), event(2, 'a:t1')]);
  expect(html).toContain('class="event-batch"');
  expect(html).toContain('data-slot="collapsible-trigger"');
  expect(html).toContain('2 条记录');
  expect(html.match(/<button[^>]*class="[^"]*\bactivity-record(?: |")/g)).toHaveLength(2);
  expect(html).not.toContain('原始 JSON');
  expect(html).toContain('#1');
  expect(html).toContain('#2');
  expect(html).toContain('需关注');
});

it('显示编号相同的不同任务不会误并为一组', () => {
  const html = renderEvents([event(1, 'a:t1'), event(2, 'b:t1')]);
  expect(html.match(/class="event-batch"/g)).toHaveLength(2);
  expect(html.match(/<button[^>]*class="[^"]*\bactivity-record(?: |")/g)).toHaveLength(2);
  expect(html).not.toContain('原始 JSON');
});

it('有更早历史时明确加载范围，不将当前窗口当作全部历史', () => {
  const html = renderEvents([event(1, 'a:t1')], true);
  expect(html).toContain('已加载 1 条记录');
  expect(html).toContain('更早记录尚未加载');
});


it('活动详情保留选中事实的完整原始记录，不混入其他事件', () => {
  const first = event(1, 'a:t1');
  const second = event(2, 'a:t2');
  const row = eventNavigation([first, second]).rows[0];
  const html = renderToStaticMarkup(createElement(EventRecordDetail, { row }));
  expect(html).toContain('原始 JSON');
  expect(html).toContain('a:t1');
  expect(html).not.toContain('a:t2');
  expect(html).toContain('记录 #1');
});

it('默认提供调用定位，同时保留非调用事实的完整入口', () => {
  const html = renderToStaticMarkup(createElement(EventPanel, { events: [event(1, 'a:t1')] }));
  expect(html).toContain('全部事件');
  expect(html).toContain('搜索调用');
  expect(html).toContain('invocation-filters');
  expect(html).toContain('筛选调用');
  expect(html).toContain('Token 入 / 出');
  // Turn 完成不是调用，不能为了填充列表补造一次执行。
  expect(html).toContain('已加载 0 次调用');
  expect(html).toContain('没有匹配的已提交调用');
});

it('不同 Turn 的同名效果通过稳定身份定位同一份调用详情', () => {
  const facts = ['t1', 't2'].map((turnId, index) => ({
    id: `a:${index}`, agentId: 'a', seq: index, ts: index,
    fact: { scope: 'turn', turnId, turnSeq: 1, event: {
      type: 'effect.created', data: { effectId: 'e1', createdAt: index,
        effect: { type: 'CALL', target: { providerId: 'test', capabilityId: 'read', contractId: 'archer.tool@1', revision: 'v1' }, input: { path: `/${turnId}` } },
      },
    } },
  })) as Snapshot<AgentEvent>[];
  const html = renderToStaticMarkup(createElement(EventPanel, {
    events: facts, selectedId: 't2/e1', onSelect: () => {},
  }));
  expect(html).toContain('aria-label="调用详情"');
  expect((html.match(/<button[^>]*>/g) ?? []).filter(tag => tag.includes('invocation-row') && tag.includes('aria-pressed="true"'))).toHaveLength(1);
  const start = html.indexOf('aria-label="调用详情"');
  const detail = html.slice(start, html.indexOf('</section>', start));
  expect(detail).toContain('/t2');
  expect(detail).not.toContain('/t1');
});

it('任务与交互可独立展开，选择原始记录后关闭详情归还焦点', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(EventPanel, { events: [event(1, 'a:t1')] })));
  act(() => [...container.querySelectorAll('button')].find(node => node.textContent === '全部事件')!.click());
  const interaction = container.querySelector<HTMLButtonElement>('.event-interaction > [data-slot="collapsible-trigger"]')!;
  expect(interaction.getAttribute('aria-expanded')).toBe('false');
  act(() => interaction.click());
  expect(interaction.getAttribute('aria-expanded')).toBe('true');
  const row = container.querySelector<HTMLButtonElement>('.activity-record')!;
  act(() => row.click());
  expect(container.querySelector('.activity-record-detail')?.textContent).toContain('记录 #1');
  const raw = container.querySelector<HTMLButtonElement>('.event-raw > [data-slot="collapsible-trigger"]')!;
  act(() => raw.click());
  expect(raw.getAttribute('aria-expanded')).toBe('true');
  expect(container.querySelector('.event-raw pre')?.textContent).toContain('a:t1');
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="关闭活动详情"]')!.click());
  expect(container.querySelector('.activity-record-detail')).toBeNull();
  expect(document.activeElement).toBe(row);
});
