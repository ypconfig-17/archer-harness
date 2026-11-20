/** 验证变更工作区展示事实与不确定范围，不依赖浏览器。 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ChangesPanel } from '../../../apps/desktop/renderer/src/ui/panels/ChangesPanel';
import { HistoricalDiff } from '@archer/ui';
import { InspectChanges, TaskInsights } from '../../../apps/desktop/renderer/src/ui/workspace/TaskInsights';
import { OutputBlock } from '../../../apps/desktop/renderer/src/ui/workspace/ToolOutput';
import { changeTree } from '../../../apps/desktop/renderer/src/lib/change-tree';
import type { EffectEntry } from '../../../apps/desktop/renderer/src/lib/conversation';

function change(path: string, before: string | null | undefined, after: string): EffectEntry {
  return { effectId: 'e', turnId: 't', createdAt: 1, attempt: 1, effectType: 'CALL', end: {
    type: 'effect.completed', data: { effectId: 'e', effectType: 'CALL', result: { value: { metadata: {
      fileChange: { path, ...(before === undefined ? {} : { before }), after },
    } } }, durationMs: 1, finishedAt: 2 },
  } } as EffectEntry;
}

it('同一路径只列一个文件，不连续内容只展示最新记录', () => {
  const entries = [change('/src/A.ts', 'old', 'one'), change('/src/A.ts', 'one', 'two'), change('/src/A.ts', 'external', 'three')];
  const html = renderToStaticMarkup(createElement(ChangesPanel, { entries, hasEarlier: true }));
  // 服务端静态渲染尚未测量容器，默认收起目录，但仍须合并连续修改。
  expect(html).toContain('A.ts');
  expect(html).not.toContain('修改片段 3');
  expect(html).not.toContain('修改片段 2');
  expect(html).toContain('展示最新记录');
  expect(html).toContain('更早记录尚未全部加载');
  expect(html).toContain('历史修改');
});

it('缺少原文不显示净新增数量，未完成工具结果不计入文件', () => {
  const pending = { ...change('/src/pending.ts', null, 'new'), end: undefined };
  const html = renderToStaticMarkup(createElement(ChangesPanel, { entries: [change('/src/A.ts', undefined, 'new'), pending], hasEarlier: false }));
  expect(html).toContain('行数未知');
  expect(html).toContain('未记录原文');
  expect(html).not.toContain('pending.ts');
  expect(html).not.toContain('changes-count');
});

it('差异组件提供统一和并排布局，无变化时明确提示', () => {
  const html = renderToStaticMarkup(createElement(HistoricalDiff, { before: 'old', after: 'new' }));
  expect(html).toContain('统一');
  expect(html).toContain('并排');
  const unchanged = renderToStaticMarkup(createElement(HistoricalDiff, { before: 'same', after: 'same' }));
  expect(unchanged).toContain('内容没有变化');
});

it('对话提供可展开的文件列表，同一文件只列一次，不嵌入 Diff', () => {
  const entries = [
    change('/src/A.ts', 'old', 'new'),
    change('/src/A.ts', 'new', 'next'),
    change('/src/B.ts', null, 'new'),
  ];
  const html = renderToStaticMarkup(createElement(InspectChanges.Provider, {
    value: () => {}, children: createElement(TaskInsights, { entries, complete: true }),
  }));
  expect(html).toContain('class="file-changes"');
  expect(html).toContain('aria-label="2 个文件变更，修改 1、新增 1"');
  // 不超过三项时直接预览全部文件，无需额外展开入口。
  expect(html).not.toContain('展开其余');
  // 连续修改合并后，同一路径的多个片段仍只占一个文件行。
  expect(html.match(/file-changes-row/g)).toHaveLength(2);
  expect(html).toContain('A.ts');
  expect(html).toContain('B.ts');
  expect(html).toContain('file-change-status is-modified">修改');
  expect(html).toContain('file-change-status is-added">新增');
  expect(html).not.toContain('<pre');
  expect(html).not.toContain('<details');
});

it('目录树保留目录分支、同名文件身份并压缩单子目录', () => {
  const tree = changeTree(['src/main/A.java', 'src/main/B.java', 'tests/A.java']);
  expect(tree.map(node => node.name)).toEqual(['src/main', 'tests']);
  expect(tree[0].children.map(node => node.filePath)).toEqual(['src/main/A.java', 'src/main/B.java']);
  expect(tree[1].children[0].filePath).toBe('tests/A.java');
});

it('文件导航采用目录层级，提供路径和真实内容查看入口', () => {
  const html = renderToStaticMarkup(createElement(ChangesPanel, {
    entries: [change('/docs/guide.md', '# Old', '# New')], hasEarlier: false,
  }));
  expect(html).toContain('aria-label="文件路径"');
  expect(html).toContain('aria-label="展开文件树"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain('>差异</button>');
  expect(html).not.toContain('>源码</button>');
  expect(html).not.toContain('>预览</button>');
  expect(html).not.toContain('aria-label="修改文件导航"');
});

it('空输出不渲染代码框，非空原文仍可阅读与复制', () => {
  expect(renderToStaticMarkup(createElement(OutputBlock, { text: '' }))).toBe('');
  const html = renderToStaticMarkup(createElement(OutputBlock, { text: '真实输出' }));
  expect(html).toContain('真实输出');
  expect(html).toContain('复制输出');
});

it('超过三项时预览前三项，其余文件只在展开区域出现一次', () => {
  const html = renderToStaticMarkup(createElement(TaskInsights, {
    entries: ['A', 'B', 'C', 'D', 'E'].map(name => change('/src/' + name + '.ts', null, 'new')),
    complete: true,
  }));
  expect(html).toContain('展开其余 2 个文件');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('file-changes-scroll');
  expect(html.match(/file-changes-row/g)).toHaveLength(5);
});

it('历史审阅只保留代码展示，不提供差异和源码切换', () => {
  const html = renderToStaticMarkup(createElement(ChangesPanel, {
    entries: [change('/src/a.ts', 'old', 'new')], hasEarlier: false,
  }));
  expect(html).not.toContain('文件查看方式');
  expect(html).toContain('data-slot="code-block"');
});

it('多次记录只渲染一个代码块，未知旧侧不冒充新增', () => {
  const html = renderToStaticMarkup(createElement(ChangesPanel, {
    entries: [change('/src/a.ts', null, 'first'), change('/src/a.ts', undefined, 'latest')], hasEarlier: false,
  }));
  expect(html.match(/data-slot="code-block"/g)).toHaveLength(1);
  expect(html).toContain('未记录原文');
  expect(html).not.toContain('修改片段 1');
});
