import { Switch as Primitive } from '@base-ui/react/switch';

/** 开关交互与表单语义由 Base UI 维护，宿主仍拥有最终布尔值。 */
export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  label,
  className = '',
}: {
  checked: boolean;
  onCheckedChange(checked: boolean): void;
  disabled?: boolean;
  label: string;
  className?: string;
}) {
  return (
    <Primitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      data-slot="switch"
      data-state={checked ? 'checked' : 'unchecked'}
      className={`ui-switch ${className}`.trim()}
    >
      <Primitive.Thumb />
    </Primitive.Root>
  );
}
