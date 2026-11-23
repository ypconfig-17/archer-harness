import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../../../apps/desktop/renderer/src/ui/primitives/Markdown';

function render(markdown: string): string {
  return renderToStaticMarkup(createElement(Markdown, { text: markdown }));
}

describe('Agent Markdown 回复', () => {
  it('GFM：标题、任务列表、表格、脚注与围栏代码使用官方结构', () => {
    const html = render([
      '# 标题',
      '',
      '- [x] 已完成',
      '- [ ] 未完成',
      '',
      '| 名称 | 状态 |',
      '| --- | ---: |',
      '| Archer | ok |',
      '',
      '```ts',
      'const answer = 42;',
      '```',
      '',
      '脚注[^1]',
      '',
      '[^1]: 说明',
    ].join('\n'));

    expect(html).toContain('<h1');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
    expect(html).toContain('<table');
    expect(html).toContain('text-align:right');
    expect(html).toContain('data-streamdown="code-block"');
    expect(html).toContain('>ts<');
    expect(html).toContain('const answer = 42;');
    expect(html).toContain('data-footnotes');
  });

  it('数学公式交给 KaTeX，原始 HTML 只作为字面文本出现', () => {
    const html = render('公式 $E = mc^2$。\n\n<script>alert(1)</script>');

    expect(html).toContain('class="katex"');
    expect(html).not.toContain('<script>');
    // 原始 HTML 不进入可执行节点：脚本标签转义后原样可见。
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('链接只允许 HTTP(S)，图片只允许 HTTPS 且等待用户主动加载', () => {
    const html = render([
      '[官网](https://example.com)',
      '[坏链接](javascript:alert(1))',
      '![示例](https://example.com/a.png)',
      '![http 图片](http://example.com/b.png)',
    ].join(' '));

    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('加载图片');
    expect(html).not.toContain('<img');
    expect(html).toContain('图片地址不可用');
  });

  it('保留旧式反斜杠公式定界符', () => {
    const html = render('行内 \\(a+b\\) 与块级：\n\n\\[c+d\\]');

    expect(html).toContain('class="katex"');
    expect(html).toContain('katex-display');
    expect(html).not.toContain('(a+b)');
  });

  it('代码里的反斜杠定界符保持原样，不改写成公式', () => {
    const html = render('行内代码 `\\(a+b\\)`\n\n```\n\\(c+d\\)\n```');

    expect(html).not.toContain('class="katex"');
    expect(html).toContain('\\(a+b\\)');
    expect(html).toContain('\\(c+d\\)');
  });

  it('未闭合的围栏代码与公式不吞掉后续正文', () => {
    const html = render('```ts\nconst a = 1');

    expect(html).toContain('data-streamdown="code-block"');
    expect(html).toContain('const a = 1');
    expect(render('未闭合公式 $x + y')).toContain('$x + y');
  });

  it('Mermaid 围栏交给图表渲染器，不降级成普通代码块', () => {
    const html = render('```mermaid\nflowchart LR\nA --> B\n```');

    expect(html).not.toContain('<pre');
    expect(html).toContain('animate-spin');
  });

  it('CJK 加粗连标点一起显示为强调', () => {
    const html = render('**中文，标点。**普通');

    expect(html).toContain('font-semibold');
    expect(html).toContain('>中文，标点。</span>普通');
  });
});
