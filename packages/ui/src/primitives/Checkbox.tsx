import { Checkbox as Primitive } from '@base-ui/react/checkbox';
import { Icon } from './Icon.js';

/** 复选框只表达宿主确认值；键盘、禁用和表单状态由 Base UI 维护。 */
export function Checkbox({ className = '', ...props }: Primitive.Root.Props) {
  return (
    <Primitive.Root {...props} className={`ui-checkbox ${className}`}>
      <Primitive.Indicator>
        <Icon name="check" size="xs" />
      </Primitive.Indicator>
    </Primitive.Root>
  );
}
