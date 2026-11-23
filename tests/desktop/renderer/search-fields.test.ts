/** 组合搜索字段只画一层边界：外层承担焦点描边，内部输入不得叠加第二层边框或光圈。 */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const directory = new URL('../../../apps/desktop/renderer/src/ui/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, directory), 'utf8');

/** 逐条取出选择器最后命中的声明；同名规则合并，避免后出现的覆盖被漏检。 */
function declarations(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...source.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))];
  return matches.map(match => match[1]).join(';');
}

const COMPOSED_SEARCHES: Array<[string, string]> = [
  ['panels/inspector.css', '.changes-search'],
  ['workspace/conversation.css', '.management-search'],
  ['navigation/navigation.css', '.search'],
];

it('组合搜索聚焦只换外层描边，输入本体不画第二层焦点', () => {
  for (const [file, selector] of COMPOSED_SEARCHES) {
    const css = read(file);
    const focus = declarations(css, `${selector}:focus-within`);
    expect(focus, `${file} ${selector} 聚焦应改变描边颜色`).toContain('border-color: var(--accent)');
    expect(focus, `${file} ${selector} 聚焦不得叠加光圈`).not.toContain('box-shadow');
    expect(focus, `${file} ${selector} 聚焦不得使用外描边`).not.toContain('outline');
    expect(declarations(css, `${selector} input`), `${file} ${selector} 内部输入应无边框和阴影`)
      .toContain('box-shadow: none');
    expect(declarations(css, `${selector} input:focus-visible`), `${file} ${selector} 内部输入聚焦不得画光圈`)
      .toContain('box-shadow: none');
  }
});
