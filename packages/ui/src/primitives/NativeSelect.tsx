import { Children, isValidElement, type ComponentPropsWithoutRef, type ReactNode } from 'react';

type OptionElement = {
  type?: unknown;
  props: { value?: unknown; selected?: boolean; children?: ReactNode };
};

/** optgroup 只是分组容器，选中项与文案仍需从真实 option 中查找。 */
function optionElements(children: ReactNode): OptionElement[] {
  return Children.toArray(children).filter(isValidElement).flatMap(child => {
    const element = child as OptionElement;
    return element.type === 'optgroup' ? optionElements(element.props.children) : [element];
  });
}

function textOf(children: ReactNode): string {
  return Children.toArray(children).map(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    if (isValidElement(child)) return textOf((child.props as { children?: ReactNode }).children);
    return '';
  }).join('');
}

/**
 * 浏览器只在选择变化时刷新 selectedcontent；活动筛选的计数会随事件加载异步变化。
 * 因此按钮文案直接由当前选项派生，不依赖 selectedcontent 的克隆时机。
 */
function selectedLabel(children: ReactNode, value: unknown): string {
  const options = optionElements(children);
  const selected = options.find(option => String(option.props.value) === String(value))
    ?? options.find(option => option.props.selected)
    ?? options[0];
  return textOf(selected?.props.children);
}

/**
 * 原生 select 的可定制外观入口：显式按钮让选中文本在固定宽度内省略，
 * 展开列表与控件边界仍由全局主题规则统一绘制。
 *
 * 仅用于仍依赖原生 base-select 行为的密集表单；对话输入区的模型、推理与
 * 命令模式使用官方 Base UI Select / DropdownMenu（见 Select.tsx）。
 */
export function NativeSelect({
  className = '',
  children,
  ...props
}: ComponentPropsWithoutRef<'select'>) {
  return (
    <select {...props} className={`ui-select ${className}`.trim()}>
      <button type="button" tabIndex={-1} aria-hidden="true">
        <span className="ui-select-label">{selectedLabel(children, props.value)}</span>
      </button>
      {children}
    </select>
  );
}