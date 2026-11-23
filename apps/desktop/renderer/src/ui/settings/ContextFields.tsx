import { createContext, useContext, useEffect, useState } from 'react';
import type { ContextCondition, ContextMetric, ContextOperator } from '@archer/contracts';
import { Button, Icon, Input, NativeSelect } from '@archer/ui';
import { SettingRow } from './SettingsControls';

/** 数值输入只提交合法值；错误由字段自身展示，同时阻止整页保存。 */
export type FieldErrorReporter = (key: string, message: string) => void;
export const ContextFieldErrors = createContext<FieldErrorReporter>(() => {});

export function ContextNumberField({ fieldKey, label, value, min, max, step = 1, unit = 'token', integer = true, hint, inline = false, onChange }: {
  fieldKey: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  integer?: boolean;
  hint?: string;
  inline?: boolean;
  onChange(value: number): void;
}) {
  const report = useContext(ContextFieldErrors);
  const [text, setText] = useState(String(value));
  const [error, setError] = useState('');
  useEffect(() => {
    setText(current => current.trim() !== '' && Number(current) === value ? current : String(value));
  }, [value]);
  useEffect(() => {
    report(fieldKey, error);
    return () => report(fieldKey, '');
  }, [error, fieldKey, report]);

  function update(next: string) {
    setText(next);
    const parsed = Number(next);
    const valid = next.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max
      && (!integer || Number.isSafeInteger(parsed));
    if (!valid) {
      setError(integer
        ? `请输入 ${min.toLocaleString()}–${max.toLocaleString()} 之间的整数。`
        : `请输入 ${min}–${max} 之间的数值。`);
      return;
    }
    setError('');
    onChange(parsed);
  }

  const control = <div className={inline ? 'context-inline-field' : 'settings-number-field'}>
    <div>
      <Input
        aria-label={label}
        aria-invalid={Boolean(error)}
        type="number"
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={event => update(event.target.value)}
      />
      {unit && <span>{unit}</span>}
    </div>
    {error && <small role="alert">{error}</small>}
  </div>;
  if (inline) return control;
  return <SettingRow label={label} hint={hint}>{control}</SettingRow>;
}

export const METRIC_LABELS: Record<ContextMetric, string> = {
  inputRatio: '输入占用比例',
  estimatedInputTokens: '估算输入 tokens',
  uncoveredTokens: '未摘要历史 tokens',
  historyMessages: '历史消息数',
};
export const OPERATOR_LABELS: Record<ContextOperator, string> = { gte: '≥', gt: '>', lte: '≤', lt: '<' };
export const METRIC_HINTS: Record<ContextMetric, string> = {
  inputRatio: '当前完整输入估算 ÷ 输入额度，例如 0.8 表示占用 80%。',
  estimatedInputTokens: '当前请求的完整输入估算，包含固定前缀与工具声明。',
  uncoveredTokens: '尚未被已采用摘要覆盖的原始历史估算；模型不支持计量时不成立。',
  historyMessages: '会话历史消息数，不含固定前缀与参考结果。',
};

export function ContextConditionEditor({ condition, path, depth, onChange, onRemove }: {
  condition: ContextCondition;
  path: string;
  depth: number;
  onChange(condition: ContextCondition): void;
  onRemove?: () => void;
}) {
  if (condition.kind === 'compare') {
    const ratio = condition.metric === 'inputRatio';
    return <div className="context-condition">
      <NativeSelect aria-label="条件指标" value={condition.metric} onChange={event => onChange({ ...condition, metric: event.target.value as ContextMetric })}>
        {Object.entries(METRIC_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </NativeSelect>
      <NativeSelect aria-label="比较方式" value={condition.op} onChange={event => onChange({ ...condition, op: event.target.value as ContextOperator })}>
        {Object.entries(OPERATOR_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </NativeSelect>
      <ContextNumberField
        inline
        fieldKey={`${path}.value`}
        label="条件数值"
        value={condition.value}
        min={0}
        max={ratio ? 10 : 1_000_000}
        step={ratio ? 0.01 : 1}
        integer={!ratio}
        unit=""
        onChange={value => onChange({ ...condition, value })}
      />
      {onRemove && <Button variant="ghost" size="icon-xs" aria-label="删除条件" onClick={onRemove}><Icon name="trash" size="sm" /></Button>}
      <small className="context-condition-hint">{METRIC_HINTS[condition.metric]}</small>
    </div>;
  }
  const replace = (index: number, next: ContextCondition) => onChange({
    ...condition,
    conditions: condition.conditions.map((item, position) => position === index ? next : item),
  });
  const remove = (index: number) => onChange({
    ...condition,
    conditions: condition.conditions.filter((_, position) => position !== index),
  });
  const addCompare = () => onChange({
    ...condition,
    conditions: [...condition.conditions, { kind: 'compare', metric: 'historyMessages', op: 'gte', value: 1 }],
  });
  const addGroup = () => onChange({
    ...condition,
    conditions: [...condition.conditions, { kind: 'all', conditions: [{ kind: 'compare', metric: 'historyMessages', op: 'gte', value: 1 }] }],
  });
  return <fieldset className="context-condition-group">
    <legend>
      <NativeSelect aria-label="条件组合方式" value={condition.kind} onChange={event => onChange({ ...condition, kind: event.target.value === 'any' ? 'any' : 'all' })}>
        <option value="all">全部满足（ALL）</option>
        <option value="any">任一满足（ANY）</option>
      </NativeSelect>
      <Button variant="link" size="xs" onClick={addCompare}><Icon name="plus" size="xs" />条件</Button>
      {depth < 3 && <Button variant="link" size="xs" onClick={addGroup}><Icon name="plus" size="xs" />分组</Button>}
      {onRemove && <Button variant="link" size="xs" aria-label="删除条件组" onClick={onRemove}>移除此组</Button>}
    </legend>
    <div className="context-condition-children">
      {condition.conditions.map((item, index) => <ContextConditionEditor
        key={index}
        condition={item}
        path={`${path}.${index}`}
        depth={depth + 1}
        onChange={next => replace(index, next)}
        onRemove={condition.conditions.length > 1 ? () => remove(index) : undefined}
      />)}
    </div>
  </fieldset>;
}
