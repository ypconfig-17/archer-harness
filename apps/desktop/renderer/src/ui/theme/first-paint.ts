/**
 * 首帧主题背景的唯一生成入口。
 * `index.html` 在样式表加载前就要有正确的窗口底色，但色值的唯一来源仍是
 * design-tokens.css：构建时读取该文件并生成一小段 `<style>`，页面里不再
 * 手工维护第二份背景表。解析失败直接报错，避免静默回退成白屏。
 */

export interface FirstPaintEntry {
  baseTheme: string;
  appearance: 'light' | 'dark';
  background: string;
}

interface ParsedBlock {
  selector: string;
  background: string;
}

const DEFAULT_BASE_THEME = 'graphite';
const DEFAULT_APPEARANCE: FirstPaintEntry['appearance'] = 'light';

function blocks(css: string): ParsedBlock[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector!.trim(), background: body!.match(/--bg-app:\s*(#[0-9a-f]{6})\b/i)?.[1] ?? '' }))
    .filter(block => block.background !== '');
}

function entryFor(block: ParsedBlock): FirstPaintEntry | null {
  const selectors = block.selector.split(',').map(item => item.trim()).filter(item => item.startsWith(':root'));
  if (selectors.length === 0) return null;
  const baseTheme = selectors.map(item => item.match(/\[data-base-theme="([\w-]+)"\]/)?.[1]).find(Boolean) ?? DEFAULT_BASE_THEME;
  const dark = selectors.some(item => /\[data-appearance="dark"\]/.test(item));
  return { baseTheme, appearance: dark ? 'dark' : DEFAULT_APPEARANCE, background: block.background };
}

/** 按界面主题与明暗收集背景色；同一组合只保留最后一次声明，与级联结果一致。 */
export function firstPaintBackgrounds(css: string): FirstPaintEntry[] {
  const result = new Map<string, FirstPaintEntry>();
  for (const block of blocks(css)) {
    const entry = entryFor(block);
    if (entry) result.set(`${entry.baseTheme}/${entry.appearance}`, entry);
  }
  return [...result.values()];
}

/** 生成首帧样式：先默认组合，再按主题与明暗逐级覆盖，顺序与 Token 选择器一致。 */
export function firstPaintCss(css: string): string {
  const entries = firstPaintBackgrounds(css);
  const find = (baseTheme: string, appearance: FirstPaintEntry['appearance']) => {
    const entry = entries.find(item => item.baseTheme === baseTheme && item.appearance === appearance);
    if (!entry) throw new Error(`design-tokens.css 缺少 ${baseTheme}/${appearance} 的 --bg-app`);
    return entry.background;
  };
  const bases = [...new Set(entries.map(entry => entry.baseTheme))].filter(base => base !== DEFAULT_BASE_THEME);
  const rules = [
    `html{background:${find(DEFAULT_BASE_THEME, 'light')}}`,
    ...bases.map(base => `html[data-base-theme="${base}"]{background:${find(base, 'light')}}`),
    `html[data-appearance="dark"]{background:${find(DEFAULT_BASE_THEME, 'dark')}}`,
    ...bases.map(base => `html[data-base-theme="${base}"][data-appearance="dark"]{background:${find(base, 'dark')}}`),
  ];
  return rules.join('');
}