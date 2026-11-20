import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { catalog } from '../../apps/desktop/renderer/src/ui/ai-ui/playground/catalog';
import { coverage } from '../../apps/desktop/renderer/src/ui/ai-ui/playground/coverage';
import {
  PreviewFrame,
  previewLayout,
} from '../../apps/desktop/renderer/src/ui/ai-ui/playground/PreviewFrame';
import { Confirmation, Message, Task, Terminal } from '../../packages/ui/src/index';

it('每个公开组件都有独立目录页，新增导出不能悄悄缺失文档', () => {
  const path = new URL('../../packages/ui/src/index.ts', import.meta.url);
  const source = ts.createSourceFile(
    'index.ts',
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const names: string[] = [];
  for (const statement of source.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.isTypeOnly ||
      !statement.exportClause ||
      !ts.isNamedExports(statement.exportClause)
    )
      continue;
    for (const item of statement.exportClause.elements) {
      if (!item.isTypeOnly) names.push(item.name.text);
    }
  }
  const documented = catalog.flatMap((entry) => entry.exports);
  expect([...documented].sort()).toEqual([...names].sort());
  expect(new Set(catalog.map((entry) => entry.id)).size).toBe(catalog.length);
  for (const entry of catalog) {
    expect(entry.source).toMatch(/from ['"]@archer\/ui['"]/);
    expect(entry.source).not.toContain('createRoot');
    expect(entry.states.length).toBeGreaterThan(0);
    expect(typeof entry.Demo).toBe('function');
  }
});

it('实际组件的所有文档状态均可渲染，示例和源码共用同一个模块', () => {
  for (const entry of catalog.filter((item) => item.category !== 'Patterns')) {
    for (const state of entry.states) {
      expect(
        () => renderToStaticMarkup(createElement(entry.Demo, { state })),
        `${entry.id}/${state}`,
      ).not.toThrow();
    }
  }
});

it('官方覆盖清单区分部分与未实现，不暴露恢复和子 Agent 的假入口', () => {
  expect(coverage).toHaveLength(21);
  for (const name of ['Checkpoint', 'Subagent']) {
    const row = coverage.find((item) => item[0] === name)!;
    expect(row[1]).toBe('未实现');
    expect(row[3]).toBe('');
  }
  for (const row of coverage) {
    if (row[3]) expect(catalog.some((item) => item.id === row[3])).toBe(true);
  }
});

it('确认结果由宿主控制，已允许只产生历史记录而不是成功任务', () => {
  const html = renderToStaticMarkup(
    createElement(Confirmation, {
      title: '允许命令？',
      children: 'git status',
      decision: 'approved',
      onApprove() {},
      onDeny() {},
    }),
  );
  expect(html).toContain('已允许此操作');
  // 历史记录只允许展开，不再暴露授权动作。
  expect(html.match(/<button/g)).toHaveLength(1);
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain('允许此操作</button>');
  expect(html).not.toContain('任务已完成');
});

it('Terminal 保留未知结果，Task 不冒充计划，Message 安全渲染文字', () => {
  const terminal = renderToStaticMarkup(
    createElement(Terminal, { command: 'write', output: '', status: 'unknown' }),
  );
  expect(terminal).toContain('执行结果未知');
  expect(terminal).not.toContain('data-status="error"');
  const task = renderToStaticMarkup(
    createElement(Task, {
      title: '活动',
      steps: [{ id: '1', title: '读取失败', status: 'error' }],
    }),
  );
  expect(task).toContain('1 项活动');
  expect(task).not.toContain('模型声明');
  expect(
    renderToStaticMarkup(
      createElement(Message, { role: 'user', children: '<script>unsafe</script>' }),
    ),
  ).toContain('&lt;script&gt;');
});

it('预览框架按分类集中选择画布宽度与状态工具栏', () => {
  expect(previewLayout('Primitives')).toBe('component');
  expect(previewLayout('AI')).toBe('component');
  expect(previewLayout('Renderers')).toBe('reading');
  expect(previewLayout('Patterns')).toBe('workspace');
  const html = renderToStaticMarkup(
    createElement(PreviewFrame, {
      name: 'Card',
      category: 'Primitives',
      controls: createElement('span', {}, '默认'),
      children: createElement('div', {}, '内容'),
    }),
  );
  expect(html).toContain('data-layout="component"');
  expect(html).toContain('交互预览');
  expect(html).toContain('固定示例');
  expect(html).toContain('内容');
});
