/** Pierre 的 Shadow DOM 样式统一在此适配，不让业务面板复制内部选择器。
 * 并排换行的列宽约束改编自 T3 Code StyledDiffCodeView，来源见 THIRD_PARTY.md。
 */
export const DIFF_VIEW_CSS = `
:host {
  color-scheme: inherit;
  --diffs-font-size: var(--size-code);
  --diffs-line-height: var(--line-code);
}
/* 自动最小宽度会随挂载的长行变化，引起列宽和换行反复调整；两侧保持等宽且允许收缩。 */
[data-diff-type="split"][data-overflow="wrap"] {
  --diffs-code-grid: var(--diffs-grid-number-column-width) minmax(0, 1fr);
}
`;
