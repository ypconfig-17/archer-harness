/**
 * 外观由三个独立维度组成：明暗模式、界面主题（中性色板）与强调色。
 * 任意组合都由根节点属性表达，解析过程不改变布局、字号或运行配置。
 */
export type Appearance = 'light' | 'dark' | 'system';
export type ResolvedAppearance = 'light' | 'dark';
export type BaseTheme = 'graphite' | 'midnight' | 'slate' | 'warm';
export type PresetColorTheme = 'graphite-iris' | 'slate-teal' | 'carbon-amber' | 'dusty-rose';
export type ColorTheme = PresetColorTheme | 'custom';

export const DEFAULT_APPEARANCE: Appearance = 'dark';
export const DEFAULT_BASE_THEME: BaseTheme = 'graphite';
export const DEFAULT_COLOR_THEME: ColorTheme = 'graphite-iris';
export const DEFAULT_CUSTOM_ACCENT = '#8793F6';

interface BaseThemePreview {
  /** 窗口、阅读面与边界；与 design-tokens.css 的实际 Token 保持一致。 */
  background: string;
  panel: string;
  border: string;
}

export interface BaseThemeDefinition {
  id: BaseTheme;
  label: string;
  description: string;
  preview: Record<ResolvedAppearance, BaseThemePreview>;
}

/** 顺序即设置页展示顺序；新增界面主题需要同时追加对应 Token 块。 */
export const BASE_THEMES: readonly BaseThemeDefinition[] = [
  {
    id: 'graphite',
    label: 'Graphite',
    description: '冷调石墨灰',
    preview: {
      light: { background: '#F4F5F8', panel: '#FFFFFF', border: '#E3E6EE' },
      dark: { background: '#0E1015', panel: '#191C23', border: '#303540' },
    },
  },
  {
    id: 'midnight',
    label: 'Midnight',
    description: '深邃午夜黑',
    preview: {
      light: { background: '#ECEEF3', panel: '#FFFFFF', border: '#DCE0E9' },
      dark: { background: '#07080B', panel: '#101318', border: '#272D37' },
    },
  },
  {
    id: 'slate',
    label: 'Slate',
    description: '冷静蓝灰',
    preview: {
      light: { background: '#EDF1F7', panel: '#FFFFFF', border: '#DBE2ED' },
      dark: { background: '#0C111A', panel: '#141C28', border: '#2B394B' },
    },
  },
  {
    id: 'warm',
    label: 'Warm',
    description: '柔和暖灰',
    preview: {
      light: { background: '#F7F4EF', panel: '#FFFDF9', border: '#E6DED3' },
      dark: { background: '#100E0B', panel: '#1A1712', border: '#362F26' },
    },
  },
];

export interface ColorThemeDefinition {
  id: PresetColorTheme;
  label: string;
  description: string;
  /** 浅色与深色分别给填充色；文字色与前景色在 design-tokens.css 中单独定义。 */
  accent: Record<ResolvedAppearance, string>;
}

/** 强调色只覆盖 Accent Token；中性背景由界面主题决定，二者互不替换。 */
export const COLOR_THEMES: readonly ColorThemeDefinition[] = [
  {
    id: 'graphite-iris',
    label: 'Graphite Iris',
    description: '鸢尾蓝',
    accent: { light: '#6066D8', dark: '#8793F6' },
  },
  {
    id: 'slate-teal',
    label: 'Slate Teal',
    description: '青绿',
    accent: { light: '#128078', dark: '#52BAAD' },
  },
  {
    id: 'carbon-amber',
    label: 'Carbon Amber',
    description: '琥珀',
    accent: { light: '#C17D35', dark: '#E3A15D' },
  },
  {
    id: 'dusty-rose',
    label: 'Dusty Rose',
    description: '玫瑰',
    accent: { light: '#B24E71', dark: '#E28AA5' },
  },
];

export function isBaseTheme(value: unknown): value is BaseTheme {
  return BASE_THEMES.some(theme => theme.id === value);
}

export function isColorTheme(value: unknown): value is ColorTheme {
  return value === 'custom' || COLOR_THEMES.some(theme => theme.id === value);
}

export function baseThemeDefinition(id: BaseTheme): BaseThemeDefinition {
  return BASE_THEMES.find(theme => theme.id === id) ?? BASE_THEMES[0]!;
}

export function colorThemeDefinition(id: ColorTheme): ColorThemeDefinition {
  return COLOR_THEMES.find(theme => theme.id === id) ?? COLOR_THEMES[0]!;
}

const HEX_PATTERN = /^#?([\da-f]{3}|[\da-f]{6})$/i;

/** 只接受 #RGB 或 #RRGGBB，统一输出大写六位；自定义输入和持久化恢复共用同一校验。 */
export function normalizeHex(value: string): string | null {
  const match = HEX_PATTERN.exec(value.trim());
  if (!match) return null;
  const raw = match[1]!;
  const full = raw.length === 3 ? raw.split('').map(char => char + char).join('') : raw;
  return `#${full.toUpperCase()}`;
}

function hexChannels(hex: string): [number, number, number] {
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255) as [number, number, number];
}

function relativeLuminance(hex: string): number {
  const [red, green, blue] = hexChannels(hex).map(value => (
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ));
  return red! * 0.2126 + green! * 0.7152 + blue! * 0.0722;
}

export function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function mixHex(from: string, to: string, ratio: number): string {
  const source = hexChannels(from);
  const target = hexChannels(to);
  return `#${[0, 1, 2].map(index => {
    const value = Math.round((source[index]! + (target[index]! - source[index]!) * ratio) * 255);
    return value.toString(16).padStart(2, '0');
  }).join('').toUpperCase()}`;
}

/** 从原色向指定方向逐步混合，直到达到目标对比度；只调整明度，不改变色相。 */
function ensureContrast(start: string, background: string, target: number, direction: string): string {
  for (let step = 0; step <= 100; step += 1) {
    const candidate = mixHex(start, direction, step / 100);
    if (contrastRatio(candidate, background) >= target) return candidate;
  }
  return direction;
}

export interface AccentColors {
  /** 按钮、选中标记与色点使用的填充色。 */
  default: string;
  /** 强调文本使用；浅色向黑、深色向白调整，保证在中性表面上可读。 */
  text: string;
  /** 填充色之上的文字与图标。 */
  foreground: string;
}

// 取四套浅色侧栏中明度最低的 Midnight，保证自定义强调文本在任意界面主题上都可读。
const LIGHT_TEXT_TARGET = '#E7EAF0';
// 取四套深色表面中明度最高的 Slate，避免自定义强调文本在蓝灰表面上刚好不足。
const DARK_TEXT_TARGET = '#1D2735';
const ACCENT_DARK_TEXT = '#101218';
const ACCENT_LIGHT_TEXT = '#FFFFFF';

/** 自定义强调色在运行时推导填充、文字与前景；预设色值仍由 Token 文件手工校准。 */
export function deriveAccent(value: string, appearance: ResolvedAppearance): AccentColors {
  const input = normalizeHex(value) ?? DEFAULT_CUSTOM_ACCENT;
  const text = ensureContrast(
    input,
    appearance === 'light' ? LIGHT_TEXT_TARGET : DARK_TEXT_TARGET,
    4.5,
    appearance === 'light' ? '#000000' : '#FFFFFF',
  );
  let fill = input;
  let foreground = contrastRatio(ACCENT_LIGHT_TEXT, fill) >= contrastRatio(ACCENT_DARK_TEXT, fill)
    ? ACCENT_LIGHT_TEXT
    : ACCENT_DARK_TEXT;
  if (contrastRatio(foreground, fill) < 4.5) {
    fill = ensureContrast(fill, foreground, 4.5, foreground === ACCENT_LIGHT_TEXT ? '#000000' : '#FFFFFF');
    foreground = contrastRatio(ACCENT_LIGHT_TEXT, fill) >= contrastRatio(ACCENT_DARK_TEXT, fill)
      ? ACCENT_LIGHT_TEXT
      : ACCENT_DARK_TEXT;
    if (contrastRatio(foreground, fill) < 4.5) {
      fill = ensureContrast(fill, foreground, 4.5, foreground === ACCENT_LIGHT_TEXT ? '#000000' : '#FFFFFF');
    }
  }
  return { default: fill, text, foreground };
}

/** 设置页色点与缩略卡取当前最终填充色，避免在组件里复制色值。 */
export function themeAccentFill(theme: ColorTheme, customAccent: string, appearance: ResolvedAppearance): string {
  if (theme === 'custom') return deriveAccent(customAccent, appearance).default;
  return colorThemeDefinition(theme).accent[appearance];
}

export interface ThemeSelection {
  appearance: Appearance;
  baseTheme: BaseTheme;
  colorTheme: ColorTheme;
  customAccent: string;
}

export interface ResolvedTheme {
  appearance: ResolvedAppearance;
  baseTheme: BaseTheme;
  colorTheme: ColorTheme;
}

export function resolveTheme(selection: ThemeSelection, systemDark: boolean): ResolvedTheme {
  return {
    appearance: selection.appearance === 'system'
      ? systemDark ? 'dark' : 'light'
      : selection.appearance,
    baseTheme: selection.baseTheme,
    colorTheme: selection.colorTheme,
  };
}

/**
 * 唯一主题写入点：先解析系统明暗，再把三个维度写到根节点。
 * 自定义强调色以内联变量覆盖 Token 回退值；其余主题只靠属性选择样式。
 * 根背景由 design-tokens.css 的 `html { background: var(--bg-app) }` 承担，
 * index.html 的首帧副本由构建从同一文件生成，因此这里不再写内联色值。
 */
export function applyTheme(selection: ThemeSelection, systemDark: boolean): ResolvedTheme {
  const resolved = resolveTheme(selection, systemDark);
  const root = document.documentElement;
  root.dataset.appearance = resolved.appearance;
  root.dataset.baseTheme = resolved.baseTheme;
  root.dataset.theme = resolved.colorTheme;
  for (const token of ['--accent-custom', '--accent-default', '--accent-text', '--accent-foreground']) {
    root.style.removeProperty(token);
  }
  if (resolved.colorTheme === 'custom') {
    const accent = deriveAccent(selection.customAccent, resolved.appearance);
    root.style.setProperty('--accent-custom', accent.default);
    root.style.setProperty('--accent-default', accent.default);
    root.style.setProperty('--accent-text', accent.text);
    root.style.setProperty('--accent-foreground', accent.foreground);
  }
  return resolved;
}
