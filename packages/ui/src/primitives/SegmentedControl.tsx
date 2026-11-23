import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Toggle } from '@base-ui/react/toggle';
import { Icon, type IconName } from './Icon.js';

/** 少量互斥偏好用行内分段选择，避免把简单选项放大为整排卡片。 */
export function SegmentedControl<Value extends string>({ label, value, options, onChange, className }: {
  label: string;
  value: Value;
  options: readonly { value: Value; label: string; icon?: IconName }[];
  onChange(value: NoInfer<Value>): void;
  className?: string;
}) {
  return (
    <ToggleGroup
      value={[value]}
      multiple={false}
      onValueChange={next => {
        // 偏好必须始终有选中值，忽略重复点击产生的清空请求。
        if (next[0] !== undefined) onChange(next[0]);
      }}
      className={className ? `segmented-control ${className}` : 'segmented-control'} role="group" aria-label={label}>
      {options.map(option => (
        <Toggle
          key={option.value}
          value={option.value}
          aria-pressed={value === option.value}
        >
          {option.icon && <Icon name={option.icon} size="sm" />}
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
