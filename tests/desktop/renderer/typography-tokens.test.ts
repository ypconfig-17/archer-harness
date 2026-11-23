import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

function cssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? cssFiles(path) : entry.name.endsWith('.css') ? [path] : [];
  });
}

it('自有组件不另设字体刻度，第三方原版排版通过桥接接入', () => {
  const roots = ['apps/desktop/renderer/src', 'packages/ui/src'];
  const violations: string[] = [];
  for (const file of roots.flatMap(root => cssFiles(resolve(root)))) {
    // 唯一刻度入口、第三方原版排版与隔离的官方对照页有意排除；产品桥接层仍接受检查。
    if (file.endsWith('/design-tokens.css') || file.endsWith('/markdown/typeset.css')
      || file.includes('/playground/reference/')) continue;
    const content = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of content.matchAll(/(?:^|[;{])\s*(font(?:-size|-family|-weight)?|line-height)\s*:\s*([^;}]+)/g)) {
      const value = match[2]!.trim();
      if (!value.includes('var(') && !['inherit', 'normal', 'initial', 'unset'].includes(value)) {
        violations.push(`${file}: ${match[1]}: ${value}`);
      }
    }
    if (/--(?:text-(?:xs|sm|base|lg|xl|\dxl)|font-(?:sans|mono|heading|weight-\w+))\s*:/.test(content)) {
      violations.push(`${file}: 字体桥接必须在 design-tokens.css 定义`);
    }
  }
  expect(violations).toEqual([]);
});
