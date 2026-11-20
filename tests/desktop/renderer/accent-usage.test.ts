/** 强调色必须落到正式主页组件，而不只存在于设置预览与 Token 定义。 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';

const directory = new URL('../../../apps/desktop/renderer/src/ui/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, directory), 'utf8');
/** 基础控件与 AI 展示组件共用 @archer/ui 的样式，语义色同样要在包内落地。 */
const library = new URL('../../../packages/ui/src/', import.meta.url);
const readLibrary = (path: string) => readFileSync(new URL(path, library), 'utf8');

/** 逐条取出选择器最后命中的声明；同名规则合并，避免后出现的覆盖被漏检。 */
function declarations(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...source.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))];
  return matches.map(match => match[1]).join(';');
}

const TOKENS = [
  '--accent:',
  '--accent-default:',
  '--accent-text:',
  '--accent-foreground:',
  '--accent-hover:',
  '--accent-pressed:',
  '--accent-subtle:',
  '--accent-subtle-hover:',
  '--accent-border:',
  '--accent-focus-ring:',
  '--accent-muted:',
];

it('强调色提供填充、文字、浅表面、边界、焦点与交互层级', () => {
  const tokens = read('theme/design-tokens.css');
  for (const token of TOKENS) expect(tokens, token).toContain(token);
});

const HOME_RULES: Array<[string, string, string]> = [
  ['navigation/navigation.css', '.chat-dot.running', '--accent'],
  ['navigation/navigation.css', ".app-sidebar [data-sidebar='menu-button'][data-active] > svg:first-child", '--accent-muted'],
  ['workspace/activity.css', '.composer-picker:focus-within', '--accent-border'],
  ['workspace/conversation.css', '.current-plan-dock li.is-current', '--accent-subtle'],
  ['workspace/composer.css', '.composer:focus-within', '--accent'],
  ['workspace/composer.css', '.composer:focus-within', '--focus-ring'],
  ['workspace/conversation.css', '.activity.is-running', '--accent-text'],
  ['workspace/conversation.css', '.management-state.running', '--accent-text'],
  ['workspace/workspace-content.css', '.execution-badge.running', '--accent-subtle'],
];

it('当前阶段的图标和加载指示器跟随强调色，正文保持辅助色', () => {
  // 通过 CSS 级联验证着色结果，让分组选择器与独立规则接受同样的行为检查。
  const { window } = new JSDOM(`
    <div class="execution-stage-footer is-active">
      <svg></svg>
      <span class="ui-spinner"></span>
      <span>等待模型响应…</span>
    </div>
  `);
  try {
    const { document } = window;
    const style = document.createElement('style');
    style.textContent = read('workspace/workspace-content.css');
    document.head.append(style);
    document.documentElement.style.setProperty('--accent', 'rgb(31, 103, 123)');
    document.documentElement.style.setProperty('--secondary', 'rgb(92, 97, 101)');

    const stage = document.querySelector('.execution-stage-footer')!;
    const [icon, spinner, label] = Array.from(stage.children);
    expect(window.getComputedStyle(icon).color).toBe('rgb(31, 103, 123)');
    expect(window.getComputedStyle(spinner).color).toBe('rgb(31, 103, 123)');
    expect(window.getComputedStyle(label).color).toBe('rgb(92, 97, 101)');
  } finally {
    window.close();
  }
});

/** 视图页签与 Turn 摘要已收敛到 @archer/ui，强调色断言跟随组件所在文件。 */
const LIBRARY_ACCENT_RULES: Array<[string, string, string]> = [
  ['primitives/surfaces.css', '.ui-tabs button[aria-selected=\'true\']', '--accent-text'],
  ['primitives/surfaces.css', '.ui-tabs button[aria-selected=\'true\']', '--accent'],
  ['styles.css', '.archer-turn-summary[data-tone=\'running\'] strong', '--accent-text'],
];

it('主页导航、当前活动、输入与主操作实际消费强调色', () => {
  for (const [file, selector, token] of HOME_RULES) {
    expect(declarations(read(file), selector), `${file} ${selector} 缺少 ${token}`).toContain(`var(${token})`);
  }
  for (const [file, selector, token] of LIBRARY_ACCENT_RULES) {
    expect(declarations(readLibrary(file), selector), `@archer/ui ${file} ${selector} 缺少 ${token}`).toContain(`var(${token})`);
  }
  // 主操作按钮由 shadcn 变体消费 --color-primary，桥接层必须指向强调色。
  expect(readLibrary('theme/shadcn.css')).toContain('--color-primary: var(--accent);');
  expect(readLibrary('theme/shadcn.css')).toContain('--color-primary-foreground: var(--on-accent);');
  // 发送键已收敛到共享输入区组件，强调色仍由默认按钮变体提供。
  for (const file of ['workspace/AgentDetail.tsx', 'workspace/NewAgentForm.tsx']) {
    expect(read(file), `${file} 发送键应使用共享发送键`).toContain('ComposerSendButton');
  }
  expect(read('workspace/ComposerPrompt.tsx')).toContain('className="send-button"');
  expect(readLibrary('ai/PromptInput.tsx')).toContain('variant = "default"');
});

it('会话选中使用浅强调背景，普通悬停保持中性', () => {
  const css = read('navigation/navigation.css');
  // 选择跟随强调色 Token，避免固定色值破坏深浅主题与自定义强调色。
  expect(
    declarations(css, '.app-sidebar [data-sidebar=\'menu-button\']:hover'),
  ).toContain('var(--surface-hover)');
  expect(
    declarations(css, '.app-sidebar [data-sidebar=\'menu-sub-button\'][data-active]'),
  ).toContain('var(--accent-subtle)');
  expect(declarations(css, '.search')).toContain('transparent');
  expect(css).not.toContain('inset 2px');
  // 不再维护第二套行与分组样式。
  expect(css).not.toContain('.chat-link');
  expect(css).not.toContain('.workspace-group');
});

const SEMANTIC_RULES: Array<[string, string, string]> = [
  ['workspace/workspace-content.css', '.execution-badge.ok', '--success'],
  ['workspace/workspace-content.css', '.execution-badge.warning', '--warning'],
  ['workspace/workspace-content.css', '.execution-badge.error', '--danger'],
  ['workspace/conversation.css', '.management-state.paused', '--warning'],
  ['navigation/navigation.css', '.chat-dot.paused', '--warning'],
];

/** Turn 结束状态的语义色随统一摘要组件迁入 @archer/ui。 */
const LIBRARY_SEMANTIC_RULES: Array<[string, string, string]> = [
  ['styles.css', '.archer-turn-summary[data-status=\'completed\'] strong', '--success'],
  ['styles.css', '.archer-turn-summary[data-status=\'failed\'] strong', '--danger'],
  ['styles.css', '.archer-turn-summary[data-tone=\'warning\'] strong', '--warning'],
];

it('成功、失败、警告与暂停仍使用独立语义色，运行状态不再占用固定蓝色', () => {
  for (const [file, selector, token] of SEMANTIC_RULES) {
    expect(declarations(read(file), selector), `${file} ${selector} 缺少 ${token}`).toContain(`var(${token})`);
  }
  for (const [file, selector, token] of LIBRARY_SEMANTIC_RULES) {
    expect(declarations(readLibrary(file), selector), `@archer/ui ${file} ${selector} 缺少 ${token}`).toContain(`var(${token})`);
  }
  const allCss = [
    'navigation/navigation.css',
    'workspace/activity.css',
    'workspace/workspace-interactions.css',
    'workspace/workspace-content.css',
    'workspace/conversation.css',
    'workspace/composer.css',
    'panels/inspector.css',
    'primitives/surfaces.css',
    'theme/design-tokens.css',
  ].map(read).join('\n');
  expect(allCss).not.toContain('--run-active');
});
