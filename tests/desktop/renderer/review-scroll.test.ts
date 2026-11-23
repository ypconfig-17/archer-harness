// @vitest-environment jsdom
/** 文件切换恢复阅读位置，不让不同任务或比较范围共享位置。 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useReviewScroll } from '../../../apps/desktop/renderer/src/hooks/use-review-scroll';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('ResizeObserver', class {
  observe() {}
  disconnect() {}
});

function Reader({ identity }: { identity: string }) {
  const ref = useReviewScroll(identity);
  return createElement('div', { ref, key: identity }, createElement('p', null, identity));
}

it('返回文件恢复位置，新来源同名文件从顶部阅读', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const render = async (identity: string) => {
    await act(async () => root.render(createElement(Reader, { identity })));
    return host.firstElementChild as HTMLDivElement;
  };
  const a = await render('turn1/a');
  a.dispatchEvent(new Event('wheel'));
  a.scrollTop = 420;
  a.scrollLeft = 25;
  a.dispatchEvent(new Event('scroll'));
  const b = await render('turn1/b');
  expect(b.scrollTop).toBe(0);
  const restored = await render('turn1/a');
  expect(restored.scrollTop).toBe(420);
  expect(restored.scrollLeft).toBe(25);
  expect((await render('turn2/a')).scrollTop).toBe(0);
  await act(async () => root.unmount());
});
