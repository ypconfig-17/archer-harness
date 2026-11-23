// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TurnSnapshot } from '@archer/contracts';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../../apps/desktop/renderer/src/lib/api', () => ({ client: {} }));
import { PendingInteraction } from '../../../apps/desktop/renderer/src/ui/workspace/PendingInteraction';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let query: QueryClient;
afterEach(() => {
  act(() => root?.unmount());
  query?.clear();
  document.body.replaceChildren();
});

/** 只操作待确认输入，任何未经显式提交的控件动作都不能调用服务。 */
function mount(pending: unknown) {
  query = new QueryClient();
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(QueryClientProvider, {
    client: query,
    children: createElement(PendingInteraction, {
      agentId: 'a', events: [],
      turn: { turnId: 't', pending } as TurnSnapshot,
    }),
  })));
  return container;
}

it('人工选项保持互斥，清除后允许自定义回答', () => {
  const container = mount({
    kind: 'human', effectId: 'e', reason: '选择方式', options: ['甲', '乙'],
  });
  const radios = container.querySelectorAll<HTMLElement>('[role="radio"]');
  act(() => radios[0]!.click());
  expect(radios[0]!.getAttribute('aria-checked')).toBe('true');
  act(() => radios[1]!.click());
  expect(radios[0]!.getAttribute('aria-checked')).toBe('false');
  expect(radios[1]!.getAttribute('aria-checked')).toBe('true');
  const clear = [...container.querySelectorAll('button')].find(node => node.textContent === '清除选择')!;
  act(() => clear.click());
  expect(radios[1]!.getAttribute('aria-checked')).toBe('false');
  expect(container.querySelector('[role="radiogroup"] [aria-checked="true"]')).toBeNull();
});

it('未知结果必须先核查确认才能请求重试，勾选不会自动执行', () => {
  const container = mount({
    kind: 'reconcile', effectId: 'e',
    target: { providerId: 'shell', capabilityId: 'bash', contractId: 'archer.tool@1', revision: 'v1' },
  });
  const retry = [...container.querySelectorAll('button')].find(node => node.textContent?.trim() === '明确重试原操作')!;
  expect(retry.disabled).toBe(true);
  const check = container.querySelector<HTMLElement>('[role="checkbox"]')!;
  act(() => check.click());
  expect(check.getAttribute('aria-checked')).toBe('true');
  expect(retry.disabled).toBe(false);
  act(() => check.click());
  expect(retry.disabled).toBe(true);
});
