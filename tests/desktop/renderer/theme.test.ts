/** 验证三维外观正交、本机恢复、四套中性色板、五类强调色与真实调色板的可读对比度。 */
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { firstPaintCss } from '../../../apps/desktop/renderer/src/ui/theme/first-paint';
import {
  BASE_THEMES,
  COLOR_THEMES,
  DEFAULT_APPEARANCE,
  DEFAULT_BASE_THEME,
  DEFAULT_COLOR_THEME,
  DEFAULT_CUSTOM_ACCENT,
  applyTheme,
  baseThemeDefinition,
  colorThemeDefinition,
  contrastRatio,
  deriveAccent,
  isBaseTheme,
  isColorTheme,
  normalizeHex,
  resolveTheme,
  themeAccentFill,
  type BaseTheme,
  type ColorTheme,
  type ResolvedAppearance,
} from '../../../apps/desktop/renderer/src/ui/theme/theme';

afterEach(() => vi.unstubAllGlobals());

it('默认组合为深色、Graphite 与 Graphite Iris，未知标识回退默认', () => {
  expect(DEFAULT_APPEARANCE).toBe('dark');
  expect(DEFAULT_BASE_THEME).toBe('graphite');
  expect(DEFAULT_COLOR_THEME).toBe('graphite-iris');
  expect(DEFAULT_CUSTOM_ACCENT).toBe('#8793F6');
  expect(BASE_THEMES.map(theme => theme.id)).toEqual(['graphite', 'midnight', 'slate', 'warm']);
  expect(COLOR_THEMES.map(theme => theme.id)).toEqual(['graphite-iris', 'slate-teal', 'carbon-amber', 'dusty-rose']);
  expect(isBaseTheme('slate')).toBe(true);
  expect(isBaseTheme('graphite-iris')).toBe(false);
  expect(isColorTheme('dusty-rose')).toBe(true);
  expect(isColorTheme('custom')).toBe(true);
  expect(isColorTheme('graphite')).toBe(false);
  expect(baseThemeDefinition('unknown' as BaseTheme).id).toBe('graphite');
  expect(colorThemeDefinition('unknown' as ColorTheme).id).toBe('graphite-iris');
});

it('跟随系统只改变明暗，界面主题与强调色保持不变', () => {
  const selection = { appearance: 'system' as const, baseTheme: 'warm' as const, colorTheme: 'dusty-rose' as const, customAccent: DEFAULT_CUSTOM_ACCENT };
  expect(resolveTheme(selection, true)).toEqual({ appearance: 'dark', baseTheme: 'warm', colorTheme: 'dusty-rose' });
  expect(resolveTheme(selection, false)).toEqual({ appearance: 'light', baseTheme: 'warm', colorTheme: 'dusty-rose' });
  expect(resolveTheme({ ...selection, appearance: 'light' }, true).appearance).toBe('light');
  expect(resolveTheme({ ...selection, appearance: 'dark' }, false).appearance).toBe('dark');
});

it('主题写入只更新三个维度属性，根背景由 CSS Token 承担', () => {
  const dataset: Record<string, string> = {};
  const tokens = new Map<string, string>();
  const style = {
    backgroundColor: '',
    setProperty(key: string, value: string) { tokens.set(key, value); },
    removeProperty(key: string) { tokens.delete(key); },
  };
  vi.stubGlobal('document', { documentElement: { dataset, style } });
  const resolved = applyTheme({
    appearance: 'system',
    baseTheme: 'slate',
    colorTheme: 'dusty-rose',
    customAccent: DEFAULT_CUSTOM_ACCENT,
  }, true);
  expect(resolved).toEqual({ appearance: 'dark', baseTheme: 'slate', colorTheme: 'dusty-rose' });
  expect(dataset).toEqual({ appearance: 'dark', baseTheme: 'slate', theme: 'dusty-rose' });
  // 背景不再由 JS 写内联色值：首帧副本与正式样式都来自 design-tokens.css。
  expect(style.backgroundColor).toBe('');
  expect(tokens.size).toBe(0);
});

it('自定义强调色写入推导后的内联变量，切回预设时清除', () => {
  const dataset: Record<string, string> = {};
  const tokens = new Map<string, string>();
  const style = {
    backgroundColor: '',
    setProperty(key: string, value: string) { tokens.set(key, value); },
    removeProperty(key: string) { tokens.delete(key); },
  };
  vi.stubGlobal('document', { documentElement: { dataset, style } });
  applyTheme({ appearance: 'light', baseTheme: 'graphite', colorTheme: 'custom', customAccent: '#abcdef' }, false);
  const derived = deriveAccent('#ABCDEF', 'light');
  expect([...tokens.entries()]).toEqual([
    ['--accent-custom', derived.default],
    ['--accent-default', derived.default],
    ['--accent-text', derived.text],
    ['--accent-foreground', derived.foreground],
  ]);
  applyTheme({ appearance: 'light', baseTheme: 'graphite', colorTheme: 'graphite-iris', customAccent: '#ABCDEF' }, false);
  expect(tokens.size).toBe(0);
});

it('三维偏好独立持久化，未知值回退默认且字号保持独立', async () => {
  const saved = new Map<string, string>();
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  };
  vi.stubGlobal('window', { localStorage: storage });
  vi.stubGlobal('localStorage', storage);
  vi.resetModules();
  const store = (await import('../../../apps/desktop/renderer/src/store/preferences')).usePreferences;
  store.getState().setAppearance('light');
  store.getState().setBaseTheme('midnight');
  store.getState().setCustomAccent('#abc');
  store.getState().setFontSize('large');
  expect(store.getState()).toMatchObject({
    appearance: 'light',
    baseTheme: 'midnight',
    colorTheme: 'custom',
    customAccent: '#AABBCC',
    fontSize: 'large',
  });
  store.getState().resetAppearance();
  expect(store.getState()).toMatchObject({
    appearance: 'dark',
    baseTheme: 'graphite',
    colorTheme: 'graphite-iris',
    customAccent: DEFAULT_CUSTOM_ACCENT,
  });
  vi.resetModules();
  const restored = (await import('../../../apps/desktop/renderer/src/store/preferences')).usePreferences;
  expect(restored.getState()).toMatchObject({ appearance: 'dark', baseTheme: 'graphite', fontSize: 'large' });
  const persisted = JSON.parse(saved.get('archer-preferences')!);
  persisted.state.baseTheme = 'unknown';
  persisted.state.colorTheme = 'unknown';
  persisted.state.customAccent = 'not-a-color';
  saved.set('archer-preferences', JSON.stringify(persisted));
  vi.resetModules();
  const fallback = (await import('../../../apps/desktop/renderer/src/store/preferences')).usePreferences;
  expect(fallback.getState()).toMatchObject({
    baseTheme: 'graphite',
    colorTheme: 'graphite-iris',
    customAccent: DEFAULT_CUSTOM_ACCENT,
    fontSize: 'large',
  });
});

it('HEX 校验接受三位与六位并统一大写', () => {
  expect(normalizeHex('#abc')).toBe('#AABBCC');
  expect(normalizeHex('6066d8')).toBe('#6066D8');
  expect(normalizeHex(' #8793F6 ')).toBe('#8793F6');
  expect(normalizeHex('#12345')).toBeNull();
  expect(normalizeHex('red')).toBeNull();
});

const css = readFileSync('apps/desktop/renderer/src/ui/theme/design-tokens.css', 'utf8');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)];

/** 选择器列表逐项求交；只解析当前三维组合实际命中的 Token 块。 */
function selectorApplies(selector: string, baseTheme: BaseTheme, theme: ColorTheme, appearance: ResolvedAppearance): boolean {
  if (!selector.startsWith(':root')) return false;
  for (const [, key, value] of selector.matchAll(/\[([\w-]+)="([^"]+)"\]/g)) {
    if (key === 'data-base-theme' && baseTheme !== value) return false;
    if (key === 'data-theme' && theme !== value) return false;
    if (key === 'data-appearance' && appearance !== value) return false;
  }
  if (selector.includes(':not([data-appearance="dark"])') && appearance === 'dark') return false;
  return true;
}

function palette(baseTheme: BaseTheme, theme: ColorTheme, appearance: ResolvedAppearance) {
  const result: Record<string, string> = {};
  for (const [, rawSelector, body] of rules) {
    const selectors = rawSelector.replace(/\/\*[\s\S]*?\*\//g, '').split(',').map(item => item.trim());
    if (!selectors.some(selector => selectorApplies(selector, baseTheme, theme, appearance))) continue;
    for (const [, key, value] of body.matchAll(/--([\w-]+):\s*(#[\da-f]{6})\b/gi)) result[key] = value;
  }
  return result;
}

const APPEARANCES = ['light', 'dark'] as const;
const BASES = BASE_THEMES.map(theme => theme.id);
const THEMES = COLOR_THEMES.map(theme => theme.id);

/** 相对亮度由对比度公式反推，避免测试再维护一份色值计算。 */
function luminance(hex: string): number {
  return 0.05 * contrastRatio(hex, '#000000') - 0.05;
}

it('悬停、选中与按下在同一方向上逐级增强，悬停不再与抬起表面同色', () => {
  for (const base of BASES) {
    for (const appearance of APPEARANCES) {
      const colors = palette(base, 'graphite-iris', appearance);
      const label = `${base}/${appearance}`;
      const [surface, raised, hover, selected, active] = ['surface', 'surface-raised', 'surface-hover', 'surface-selected', 'surface-active']
        .map(key => luminance(colors[key]!));
      // 浅色交互态逐级下沉，深色逐级提亮；两者都不与静止表面共用色值。
      const direction = appearance === 'light' ? -1 : 1;
      expect((hover! - surface!) * direction, `${label} 悬停应离开静止表面`).toBeGreaterThan(0);
      expect((selected! - hover!) * direction, `${label} 选中应强于悬停`).toBeGreaterThan(0);
      expect((active! - selected!) * direction, `${label} 按下应强于选中`).toBeGreaterThan(0);
      expect(contrastRatio(colors['surface-hover']!, colors['surface-raised']!), `${label} 悬停与抬起表面过于接近`).toBeGreaterThan(1.03);
      expect(contrastRatio(colors['surface-selected']!, colors['surface-hover']!), `${label} 选中与悬停过于接近`).toBeGreaterThan(1.05);
      expect(contrastRatio(colors['text-primary']!, colors['surface-selected']!), `${label} 选中行文字对比度`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors['text-secondary']!, colors['surface-hover']!), `${label} 悬停行辅助文字对比度`).toBeGreaterThanOrEqual(4.5);
      expect(raised).toBeGreaterThanOrEqual(Math.min(surface!, raised!));
    }
  }
});

it('普通控件表面保持中性，强调色只进入主操作与焦点', () => {
  const names = ['--control-surface', '--control-surface-hover', '--control-border'];
  const declarations = names.map(name => css.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1] ?? '');
  expect(declarations.every(Boolean)).toBe(true);
  for (const declaration of declarations) {
    expect(declaration).not.toContain('--accent');
    expect(declaration).toContain('--text-primary');
  }
});

it('首帧背景由 Token 生成，index.html 不再保留第二份色值', () => {
  const firstPaint = firstPaintCss(css);
  const html = readFileSync('apps/desktop/renderer/index.html', 'utf8');
  expect(html).toContain('<!--theme-first-paint-->');
  expect(html).not.toMatch(/#[\da-f]{6}\b/i);
  for (const theme of BASE_THEMES) {
    for (const appearance of APPEARANCES) {
      const selector = theme.id === 'graphite'
        ? appearance === 'light' ? 'html' : 'html[data-appearance="dark"]'
        : `html[data-base-theme="${theme.id}"]${appearance === 'dark' ? '[data-appearance="dark"]' : ''}`;
      const background = palette(theme.id, 'graphite-iris', appearance)['bg-app'];
      expect(firstPaint, `${theme.id}/${appearance}`).toContain(`${selector}{background:${background}}`);
    }
  }
});

it('界面主题缩略色与真实中性 Token 一致', () => {
  for (const theme of BASE_THEMES) {
    for (const appearance of APPEARANCES) {
      const colors = palette(theme.id, 'graphite-iris', appearance);
      expect(theme.preview[appearance], `${theme.id} / ${appearance}`).toEqual({
        background: colors['bg-app'],
        panel: colors['bg-content'],
        border: colors['border-default'],
      });
    }
  }
});

const PAIRS: Array<[string, string]> = [
  ['text-primary', 'bg-app'],
  ['text-primary', 'bg-sidebar'],
  ['text-primary', 'bg-content'],
  ['text-secondary', 'bg-content'],
  ['text-secondary', 'bg-sidebar'],
  ['text-muted', 'surface'],
  ['text-muted', 'bg-sidebar'],
  ['accent-text', 'bg-content'],
  ['accent-text', 'bg-sidebar'],
  ['accent-text', 'surface'],
  ['accent-foreground', 'accent-default'],
  ['text-primary', 'code-background'],
  ['on-danger', 'danger'],
];

function expectReadable(colors: Record<string, string>, label: string) {
  for (const [foreground, background] of PAIRS) {
    expect(colors[foreground], `${label} 缺少 ${foreground}`).toBeDefined();
    expect(colors[background], `${label} 缺少 ${background}`).toBeDefined();
    expect(contrastRatio(colors[foreground]!, colors[background]!), `${label} ${foreground}/${background}`).toBeGreaterThanOrEqual(4.5);
  }
}

for (const base of BASES) {
  for (const theme of THEMES) {
    for (const appearance of APPEARANCES) {
      it(`${base} / ${theme} / ${appearance} 的正文、辅助文字与强调色满足 4.5:1 对比度`, () => {
        expectReadable(palette(base, theme, appearance), `${base}/${theme}/${appearance}`);
      });
    }
  }
}

it('自定义强调色在四套界面主题与两种明暗下满足 4.5:1 对比度', () => {
  const samples = ['#8793F6', '#128078', '#C17D35', '#E28AA5', '#777777', '#FFFF00', '#000000', '#FFFFFF'];
  for (const sample of samples) {
    for (const appearance of APPEARANCES) {
      const derived = deriveAccent(sample, appearance);
      for (const base of BASES) {
        expectReadable({
          ...palette(base, 'custom', appearance),
          'accent-default': derived.default,
          'accent-text': derived.text,
          'accent-foreground': derived.foreground,
        }, `${sample}/${base}/${appearance}`);
      }
    }
  }
});

it('切换强调色不改变任何中性背景与文字 Token', () => {
  for (const base of BASES) {
    for (const appearance of APPEARANCES) {
      const reference = palette(base, 'graphite-iris', appearance);
      for (const theme of THEMES.filter(id => id !== 'graphite-iris')) {
        const current = palette(base, theme, appearance);
        for (const key of Object.keys(reference).filter(key => !key.startsWith('accent-'))) {
          expect(current[key], `${base}/${theme}/${appearance}/${key}`).toBe(reference[key]);
        }
      }
    }
  }
});

it('切换界面主题不改变强调色 Token', () => {
  for (const theme of THEMES) {
    for (const appearance of APPEARANCES) {
      const reference = palette('graphite', theme, appearance);
      for (const base of BASES.filter(id => id !== 'graphite')) {
        const current = palette(base, theme, appearance);
        for (const key of Object.keys(reference).filter(key => key.startsWith('accent-'))) {
          expect(current[key], `${base}/${theme}/${appearance}/${key}`).toBe(reference[key]);
        }
      }
    }
  }
});

it('界面主题实际改变中性层，强调色块只声明强调色 Token', () => {
  for (const appearance of APPEARANCES) {
    const neutralSets = BASES.map(base => JSON.stringify(
      Object.fromEntries(Object.entries(palette(base, 'graphite-iris', appearance)).filter(([key]) => !key.startsWith('accent-'))),
    ));
    expect(new Set(neutralSets).size).toBe(BASES.length);
  }
  for (const [, rawSelector, body] of rules) {
    const selectors = rawSelector.replace(/\/\*[\s\S]*?\*\//g, '').split(',').map(item => item.trim());
    if (selectors.some(selector => selector.includes('data-theme='))) {
      for (const [, key] of body.matchAll(/--([\w-]+):/g)) expect(key!.startsWith('accent-'), key).toBe(true);
    }
    if (selectors.some(selector => selector.includes('data-base-theme='))) {
      for (const [, key] of body.matchAll(/--([\w-]+):/g)) expect(key!.startsWith('accent-'), key).toBe(false);
    }
  }
});

it('色点取当前强调色的最终填充值，预设与自定义来源一致', () => {
  expect(themeAccentFill('slate-teal', DEFAULT_CUSTOM_ACCENT, 'light')).toBe('#128078');
  expect(themeAccentFill('dusty-rose', DEFAULT_CUSTOM_ACCENT, 'dark')).toBe('#E28AA5');
  expect(themeAccentFill('custom', '#ABC', 'light')).toBe(deriveAccent('#ABC', 'light').default);
});
