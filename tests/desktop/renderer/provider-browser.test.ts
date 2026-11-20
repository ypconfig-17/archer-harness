/** 只读来源浏览遵守真实注册、完整引用和原始 Schema 的边界。 */
import { expect, it } from 'vitest';
import type { ProviderInfo } from '@archer/contracts';
import { capabilityKey, providerDescription, schemaFields, searchProviders } from '../../../apps/desktop/renderer/src/lib/provider-browser';

const sources: ProviderInfo[] = [{
  id: 'custom-files', identity: { package: 'fixture' }, capabilities: [{
    ref: { providerId: 'custom-files', capabilityId: 'read', contractId: 'archer.tool@1', revision: 'v1' },
    metadata: { summary: '读取文本文件', execution: 'read', inputSchema: { type: 'object', properties: { path: { type: 'string', description: '绝对路径' }, options: { $ref: '#/$defs/options' } }, required: ['path'] } },
  }],
}];

it('搜索可直接命中内部能力，不依赖 Provider 的约定名字', () => {
  const result = searchProviders(sources, 'read');
  expect(result[0].source.id).toBe('custom-files');
  expect(result[0].capabilities[0].ref.capabilityId).toBe('read');
  expect(searchProviders(sources, '不存在')).toEqual([]);
  expect(providerDescription(sources[0])).toBe('读取文本文件');
});

it('同名能力的来源或 revision 不同就不是原选择', () => {
  const item = sources[0].capabilities[0];
  expect(capabilityKey(item)).not.toBe(capabilityKey({ ...item, ref: { ...item.ref, revision: 'v2' } }));
  expect(capabilityKey(item)).not.toBe(capabilityKey({ ...item, ref: { ...item.ref, providerId: 'other' } }));
});

it('字段概览不修改原始契约，不把引用展开成猜测的类型', () => {
  const schema = sources[0].capabilities[0].metadata.inputSchema;
  const original = JSON.stringify(schema);
  expect(schemaFields(schema)).toEqual([
    { name: 'path', type: 'string', required: true, description: '绝对路径' },
    { name: 'options', type: '见原始 Schema', required: false, description: '未声明说明' },
  ]);
  expect(JSON.stringify(schema)).toBe(original);
  expect(schemaFields({ oneOf: [{ type: 'string' }] })).toEqual([]);
});

it('未知契约和无能力来源不会凭名称生成工具、模型或技能', () => {
  const source = { id: 'models', identity: {}, capabilities: [] };
  expect(providerDescription(source)).toBe('尚无公开能力声明');
  expect(searchProviders([source], 'models')[0].capabilities).toEqual([]);
});

it('入口仅显示真实来源卡片，不默认展开契约或补造示例来源', async () => {
  const { vi } = await import('vitest');
  vi.stubGlobal('window', { archerDesktop: { apiUrl: 'http://127.0.0.1:3000' } });
  try {
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { ProviderBrowser } = await import('../../../apps/desktop/renderer/src/ui/settings/ProviderBrowser');
    const client = new QueryClient();
    client.setQueryData(['providers'], sources);
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(ProviderBrowser)));
    expect(html).toContain('custom-files');
    expect(html).toContain('1 项能力');
    expect(html).not.toContain('Schema 阅读方式');
    expect(html).not.toContain('shell');
    client.clear();
  } finally {
    vi.unstubAllGlobals();
  }
});
