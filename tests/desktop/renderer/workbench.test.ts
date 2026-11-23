import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { Workbench, WorkbenchHome } from '../../../apps/desktop/renderer/src/ui/panels/Workbench';
import { SessionOverview } from '../../../apps/desktop/renderer/src/ui/panels/SessionOverview';

const saved = new Map<string, string>();
async function workbench() {
  vi.resetModules();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
  vi.stubGlobal('window', { localStorage: globalThis.localStorage });
  return (await import('../../../apps/desktop/renderer/src/store/workbench')).useWorkbench;
}

const entries = [
  { view: 'review' as const, icon: 'file' as const, title: '打开审阅', description: '查看本轮工具确认的文件修改', meta: '2 个文件' },
  { view: 'activity' as const, icon: 'list' as const, title: '打开活动', description: '浏览已提交的原始事件与调用详情', meta: '18 条记录' },
];

afterEach(() => {
  saved.clear();
  vi.unstubAllGlobals();
});

it('工作台默认收起，保存像素偏好并拒绝无效宽度', async () => {
  const store = await workbench();
  expect(store.getState()).toMatchObject({ inspectorOpen: false, inspectorWidth: 400, inspectorView: 'workbench' });
  store.getState().setInspectorWidth(9999);
  expect(store.getState().inspectorWidth).toBe(9999);
  // 上界由实际面板容器决定，存储只保证有限数值与最小阅读宽度。
  store.getState().setInspectorWidth(Number.NaN);
  expect(store.getState().inspectorWidth).toBe(400);
  store.getState().setInspectorWidth(1);
  expect(store.getState().inspectorWidth).toBe(320);
  store.getState().setInspectorWidth(380);
  store.getState().setInspectorOpen(true);
  store.getState().setInspectorView('review');
  const restored = await workbench();
  // 阅读对象不持久化：重启后仍从首页开始。
  expect(restored.getState()).toMatchObject({ inspectorOpen: true, inspectorWidth: 380, inspectorView: 'workbench' });
});

it('首页只列出已有阅读对象，不伪造页签或未接入的能力', () => {
  const html = renderToStaticMarkup(createElement(WorkbenchHome, { entries, onOpen: vi.fn() }));
  expect(html).toContain('打开审阅');
  expect(html).toContain('2 个文件');
  expect(html).toContain('打开活动');
  expect(html).toContain('data-view="review"');
  expect(html).not.toContain('role="tablist"');
  expect(html).not.toContain('终端');
  expect(html).not.toContain('浏览器');
});

it('首页不提供最大化，进入阅读对象后才出现返回与整窗入口', () => {
  const home = renderToStaticMarkup(createElement(Workbench, {
    view: 'workbench', maximized: false, onView: vi.fn(), onMaximize: vi.fn(), onClose: vi.fn(),
    children: createElement(WorkbenchHome, { entries, onOpen: vi.fn() }),
  }));
  expect(home).toContain('工作台');
  expect(home).not.toContain('最大化工作台');

  const review = renderToStaticMarkup(createElement(Workbench, {
    view: 'review', maximized: true, focused: true, onView: vi.fn(),
    onFocusMode: vi.fn(), onMaximize: vi.fn(), onClose: vi.fn(), children: '文件内容',
  }));
  expect(review).toContain('审阅');
  expect(review).toContain('文件内容');
  expect(review).toContain('返回工作台');
  expect(review).toContain('is-focused');
  expect(review).toContain('退出专注模式');
  expect(review).toContain('还原工作台');
  expect(review).toContain('收起工作台');
  // 外壳 workbench 在 macOS 是透明背景；面板复用同名类会让最大化时透出下层内容。
  const rootClasses = /<aside class="([^"]*)"/.exec(review)?.[1]?.split(' ') ?? [];
  expect(rootClasses).toContain('workbench-panel');
  expect(rootClasses).not.toContain('workbench');
});

it('工作区视图与审阅共用文件阅读布局', () => {
  const html = renderToStaticMarkup(createElement(Workbench, {
    view: 'workspace', maximized: false, onView: vi.fn(), onMaximize: vi.fn(), onClose: vi.fn(),
    children: 'Git 内容',
  }));
  expect(html).toContain('工作区');
  expect(html).toContain('file-inspector');
  expect(html).toContain('Git 内容');
});

it('会话概览只列已知字段', () => {
  const html = renderToStaticMarkup(createElement(SessionOverview, {
    workspace: '/workspace/project', execution: '就绪', records: 42,
    task: '无运行中任务', queued: 0, changedFiles: 3,
  }));
  expect(html).toContain('/workspace/project');
  expect(html).toContain('42 条');
  expect(html).toContain('3 个文件');
});
