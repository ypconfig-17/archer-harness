import type { ReactNode } from 'react';
import { Tabs as Primitive } from '@base-ui/react/tabs';

export interface TabItem<Value extends string> {
  value: Value;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
}

/**
 * 页签只切换宿主视图，不负责面板内容与加载；Base UI 管理键盘导航，
 * 面板始终由调用方按 hidden 保持挂载，避免切换丢失滚动或输入。
 */
export function Tabs<Value extends string>({
  label,
  value,
  items,
  onChange,
  tabIdPrefix = 'tab',
  panelIdPrefix = 'panel',
  className = '',
}: {
  label: string;
  value: Value;
  items: readonly TabItem<Value>[];
  onChange(value: NoInfer<Value>): void;
  tabIdPrefix?: string;
  panelIdPrefix?: string;
  className?: string;
}) {
  return (
    <Primitive.Root className="ui-tabs-root" value={value} onValueChange={next => onChange(next as Value)}>
      <Primitive.List aria-label={label} className={`ui-tabs ${className}`.trim()}>
        {items.map((item) => (
          <Primitive.Tab
            key={item.value}
            id={`${tabIdPrefix}-${item.value}`}
            value={item.value}
            aria-selected={value === item.value}
            aria-controls={`${panelIdPrefix}-${item.value}`}
          >
            {item.icon}
            {item.label}
            {item.badge}
          </Primitive.Tab>
        ))}
      </Primitive.List>
    </Primitive.Root>
  );
}
