// @vitest-environment jsdom
/** 验证布局点击真正改变传给渲染器的选项，未知原文与单侧内容不提供伪切换。 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
vi.mock('../../../packages/ui/node_modules/@pierre/diffs/dist/react/index.js', () => ({
  MultiFileDiff: ({ options }: { options: { diffStyle: string; diffIndicators: string; overflow: string } }) =>
    createElement('div', { 'data-layout': options.diffStyle, 'data-indicators': options.diffIndicators, 'data-overflow': options.overflow }),
}));
import { HistoricalDiff } from '../../../packages/ui/src/renderers/HistoricalDiff';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

it('点击并排和统一改变实际渲染选项，代码外壳始终保留', async () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(createElement(HistoricalDiff, { before: 'old', after: 'new', path: 'a.ts' })));
  expect(container.querySelector('[data-slot=code-block]')).not.toBeNull();
  expect(container.querySelector('[data-layout]')?.getAttribute('data-layout')).toBe('unified');
  expect(container.querySelector('[data-indicators]')?.getAttribute('data-indicators')).toBe('classic');
  const buttons = [...container.querySelectorAll('button')];
  expect(container.querySelector('[data-layout]')?.getAttribute('data-overflow')).toBe('scroll');
  await act(async () => buttons.find(button => button.textContent === '自动换行')!.click());
  expect(container.querySelector('[data-layout]')?.getAttribute('data-overflow')).toBe('wrap');
  await act(async () => buttons.find(button => button.textContent === '并排')!.click());
  expect(container.querySelector('[data-layout]')?.getAttribute('data-layout')).toBe('split');
  expect(container.querySelector('[data-layout]')?.getAttribute('data-overflow')).toBe('wrap');
  await act(async () => buttons.find(button => button.textContent === '统一')!.click());
  expect(container.querySelector('[data-layout]')?.getAttribute('data-layout')).toBe('unified');
  await act(async () => root.render(createElement(HistoricalDiff, { before: '', after: 'new' })));
  expect(container.querySelector('[aria-label="差异布局"]')).toBeNull();
  await act(async () => root.unmount());
});
