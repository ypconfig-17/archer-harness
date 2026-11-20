// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { Switch, Tabs, SegmentedControl, Dialog, Popover, Sources, Source, ConversationViewport } from '../../packages/ui/src/index';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()));
  document.body.replaceChildren();
});

function mount(element: React.ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

it('开关只请求宿主更新，不自行覆盖受控值', () => {
  const change = vi.fn();
  const container = mount(createElement(Switch, { checked: false, label: '开关', onCheckedChange: change }));
  const button = container.querySelector<HTMLElement>('[role="switch"]')!;
  act(() => button.click());
  expect(change.mock.calls[0]?.[0]).toBe(true);
  expect(button.getAttribute('aria-checked')).toBe('false');
});

it('分段偏好重复点击不能清空，切换后只保留一个选项', () => {
  function Example() {
    const [value, setValue] = useState('a');
    return createElement(SegmentedControl, {
      label: '偏好', value, onChange: setValue,
      options: [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }],
    });
  }
  const container = mount(createElement(Example));
  const buttons = container.querySelectorAll('button');
  act(() => buttons[0]!.click());
  expect(buttons[0]!.getAttribute('aria-pressed')).toBe('true');
  act(() => buttons[1]!.click());
  expect(buttons[0]!.getAttribute('aria-pressed')).toBe('false');
  expect(buttons[1]!.getAttribute('aria-pressed')).toBe('true');
});

it('页签点击交给宿主并保留外部面板关联', () => {
  const change = vi.fn();
  const container = mount(createElement(Tabs, {
    label: '视图', value: 'a', onChange: change, panelIdPrefix: 'view',
    items: [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }],
  }));
  const tabs = container.querySelectorAll<HTMLElement>('[role="tab"]');
  act(() => tabs[1]!.click());
  expect(change).toHaveBeenCalledWith('b');
  expect(tabs[0]!.getAttribute('aria-controls')).toBe('view-a');
});

it('提交中的弹窗拒绝 Escape 关闭', () => {
  const change = vi.fn();
  mount(createElement(Dialog, {
    open: true, title: '确认', closeDisabled: true, onOpenChange: change,
  }));
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(change).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});

it('浮层通过 Portal 打开，Escape 请求关闭', async () => {
  const change = vi.fn();
  const container = mount(createElement(Popover, {
    label: '说明', onOpenChange: change, children: '浮层正文',
  }));
  await act(async () => container.querySelector('button')!.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toBe('浮层正文');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(change.mock.calls.map(call => call[0])).toEqual([true, false]);
});

it('来源折叠只切换可见性，原始链接和内容保持不变', () => {
  const container = mount(createElement(Sources, {
    children: createElement(Source, { title: '参考', href: 'https://example.com' }),
  }));
  const trigger = container.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')!;
  const panel = container.querySelector<HTMLElement>('[data-slot="collapsible-content"]')!;
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(panel.hidden).toBe(true);
  act(() => trigger.click());
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(panel.hidden).toBe(false);
  expect(panel.querySelector('a')?.href).toBe('https://example.com/');
});

it('对话视口复用滚动容器，离开底部后显式回到最新', () => {
  // 只模拟尺寸通知，滚动位置与回到底部按钮仍通过真实 DOM 观察。
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
    unobserve() {}
  });
  try {
    const container = mount(createElement(ConversationViewport, { children: '对话正文' }));
    const viewport = container.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
    Object.defineProperties(viewport, {
      scrollHeight: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 200 },
    });
    viewport.scrollTop = 80;
    act(() => viewport.dispatchEvent(new Event('scroll', { bubbles: true })));
    expect(viewport.scrollTop).toBe(80);
    const latest = [...container.querySelectorAll('button')].find(node => node.textContent === '回到最新')!;
    expect(latest).toBeDefined();
    act(() => latest.click());
    expect(viewport.scrollTop).toBe(600);
    expect(container.textContent).not.toContain('回到最新');
  } finally {
    vi.unstubAllGlobals();
  }
});
