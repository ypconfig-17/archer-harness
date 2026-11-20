import { Label, RadioGroup, RadioGroupItem } from '@archer/ui';

/** 官方单选组：值由 RadioGroup 统一管理，标签通过 Label 关联同一控件。 */
export default function Example({ state = 'default' }: { state?: string }) {
  const disabled = state === 'disabled';
  return (
    <RadioGroup defaultValue="standard" aria-label="示例选项" disabled={disabled} className="max-w-xs">
      {[
        ['compact', '紧凑', '信息密度更高'],
        ['standard', '标准', '默认节奏'],
        ['roomy', '宽松', '适合长文本'],
      ].map(([value, label, hint]) => (
        <Label key={value} className="items-start gap-3 rounded-[var(--radius-control)] p-2">
          <RadioGroupItem value={value} className="mt-1" />
          <span className="flex flex-col gap-1">
            <span>{label}</span>
            <span className="text-[length:var(--size-caption)] text-[color:var(--muted)]">{hint}</span>
          </span>
        </Label>
      ))}
    </RadioGroup>
  );
}
