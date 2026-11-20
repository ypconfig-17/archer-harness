/** 设置使用页面结构；搜索只覆盖可公开的静态设置名称。 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterAll, expect, it, vi } from 'vitest';
import { settingsMatches } from '../../../apps/desktop/renderer/src/lib/settings-search';

afterAll(() => vi.unstubAllGlobals());

it('搜索能找到设置项所属分类，支持多关键词且不索引未知值', () => {
  const section = { key: 'models', label: '模型设置', description: '模型连接' };
  expect(settingsMatches(section, ' API  Key ')).toBe(true);
  expect(settingsMatches(section, '密钥 连接')).toBe(true);
  expect(settingsMatches(section, '不存在的实际凭证')).toBe(false);
  expect(settingsMatches({ key: 'appearance', label: '外观与主题', description: '' }, '深色')).toBe(true);
});

it('设置主体不是模态，具有返回应用、搜索与独立分类导航', async () => {
  vi.stubGlobal('window', { archerDesktop: { apiUrl: 'http://127.0.0.1:3000' }, location: { hash: '', pathname: '/', search: '' }, addEventListener() {}, removeEventListener() {} });
  const { Settings } = await import('../../../apps/desktop/renderer/src/ui/settings/Settings');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Settings, { agentId: null, onAddWorkspace() {} })));
  expect(html).toContain('<section aria-label="设置工作区"');
  expect(html).toContain('返回应用');
  expect(html).toContain('aria-label="搜索设置"');
  expect(html).toContain('aria-label="设置分类"');
  // 分类是页面级导航：复用包内 Sidebar 菜单原语，选中项同时给出 aria-current。
  expect(html).toContain('data-slot="sidebar-menu-button"');
  expect(html).toContain('aria-current="page"');
  expect(html).not.toContain('class="selected"');
  expect(html).toContain('role="group" aria-label="默认文件访问"');
  expect(html).toContain('role="group" aria-label="启动时打开"');
  expect(html).not.toContain('<select aria-label="默认文件访问"');
  expect(html).not.toContain('<select aria-label="启动时打开"');
  expect(html).not.toContain('settings-dialog');
  expect(html).not.toContain('aria-label="关闭设置"');
  expect(html).toContain('hidden="" aria-label="模型设置内容"');
  const appearance = html.slice(html.indexOf('aria-label="外观与主题内容"'));
  expect(appearance).toMatch(/role="radiogroup"[^>]*aria-label="界面主题"/);
  expect(appearance).toContain('aria-label="主页实时预览"');
  expect(appearance.match(/role="radio"/g)).toHaveLength(9);
  expect(appearance).toContain('Graphite Iris');
  expect(appearance).toContain('Dusty Rose');
  expect(appearance).toContain('恢复默认');
  client.clear();
});
