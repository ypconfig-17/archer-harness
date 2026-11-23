// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { AgentEvent, Snapshot } from '@archer/contracts';
import { ContextPanel } from '../../../apps/desktop/renderer/src/ui/panels/ContextPanel';
import { EventPanel } from '../../../apps/desktop/renderer/src/ui/panels/EventPanel';
import { ElapsedTime } from '../../../apps/desktop/renderer/src/ui/workspace/ElapsedTime';
import * as conversation from '../../../apps/desktop/renderer/src/lib/conversation';

// DOM 测试只验证渲染边界与状态，不模拟浏览器真实布局测量。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: ResizeObserverStub });
Object.assign(window, { ResizeObserver: ResizeObserverStub });
Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] });
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function mount() {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  return container;
}
function facts(): Snapshot<AgentEvent>[] {
  return [{
    id: 'a:1', agentId: 'a', seq: 1, ts: 100,
    fact: { scope: 'turn', turnId: 'a:t1', turnSeq: 1, event: {
      type: 'effect.created', data: { effectId: 'e1', createdAt: 100,
        effect: { type: 'INFER', target: { providerId: 'pi', capabilityId: 'inference', contractId: 'archer.inference@1', revision: 'v1' }, messages: [{ role: 'user', content: '测试上下文' }], tools: [] },
      },
    } },
  }] as Snapshot<AgentEvent>[];
}

it('隐藏的上下文和活动页不投影事件；显示时读取最新事实', async () => {
  const container = mount();
  const project = vi.spyOn(conversation, 'buildItems');
  const events = facts();
  await act(async () => root!.render(createElement('div', null,
    createElement(ContextPanel, { events, visible: false }),
    createElement(EventPanel, { events, visible: false }),
  )));
  expect(project).not.toHaveBeenCalled();
  await act(async () => root!.render(createElement(ContextPanel, { events, visible: true })));
  expect(project).toHaveBeenCalled();
  expect(container.textContent).toContain('已加载 1 个请求');
});

it('结构视图和空搜索不序列化完整请求，只有打开原始视图才序列化', async () => {
  const container = mount();
  const stringify = vi.spyOn(JSON, 'stringify');
  const events = facts();
  const rawCalls = () => stringify.mock.calls.filter(([value]) => value && typeof value === 'object' && 'effect' in value && 'requestedAt' in value);
  await act(async () => root!.render(createElement(ContextPanel, { events })));
  expect(rawCalls()).toHaveLength(0);
  const raw = [...container.querySelectorAll('button')].find(button => button.textContent === '原始内容')!;
  await act(async () => raw.click());
  expect(rawCalls().length).toBeGreaterThan(0);
  expect(container.querySelector('.context-raw-json')?.textContent).toContain('测试上下文');
  await act(async () => root!.render(createElement(EventPanel, { events })));
  stringify.mockClear();
  await act(async () => root!.render(createElement(EventPanel, { events: [...events] })));
  expect(stringify.mock.calls.some(([value]) => value === (events[0]!.fact as { event: { data: { effect: unknown } } }).event.data.effect)).toBe(false);
});

it('隐藏再显示保留活动视图及上下文原始视图', async () => {
  const container = mount();
  const events = facts();
  await act(async () => root!.render(createElement(EventPanel, { events })));
  const all = [...container.querySelectorAll('button')].find(button => button.textContent === '全部事件')!;
  await act(async () => all.click());
  await act(async () => root!.render(createElement(EventPanel, { events, visible: false })));
  await act(async () => root!.render(createElement(EventPanel, { events, visible: true })));
  expect([...container.querySelectorAll('button')].find(button => button.textContent === '全部事件')?.getAttribute('aria-pressed')).toBe('true');
  await act(async () => root!.render(createElement(ContextPanel, { events })));
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '原始内容')!.click());
  const rawNode = container.querySelector('.context-raw-json')!;
  const viewport = container.querySelector('.context-raw-view')!.parentElement!;
  viewport.scrollTop = 43;
  await act(async () => root!.render(createElement(ContextPanel, { events, visible: false })));
  await act(async () => root!.render(createElement(ContextPanel, { events, visible: true })));
  expect(container.querySelector('.context-raw-json')).toBe(rawNode);
  expect(viewport.scrollTop).toBe(43);
  expect(rawNode.textContent).toContain('测试上下文');
});

it('逐秒更新仅发生在耗时组件，结束和固定预览不启动时钟', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  const container = mount();
  let parentRenders = 0;
  function Parent() {
    parentRenders++;
    return createElement(ElapsedTime, { startedAt: 0, running: true });
  }
  await act(async () => root!.render(createElement(Parent)));
  const before = container.textContent;
  await act(async () => vi.advanceTimersByTime(2000));
  expect(container.textContent).not.toBe(before);
  expect(parentRenders).toBe(1);
  await act(async () => root!.render(createElement(ElapsedTime, { startedAt: 0, endedAt: 5000, running: true })));
  expect(vi.getTimerCount()).toBe(0);
  const ended = container.textContent;
  await act(async () => vi.advanceTimersByTime(5000));
  expect(container.textContent).toBe(ended);
  await act(async () => root!.render(createElement(ElapsedTime, { startedAt: 0, displayTime: 2000, running: true })));
  expect(vi.getTimerCount()).toBe(0);
});
