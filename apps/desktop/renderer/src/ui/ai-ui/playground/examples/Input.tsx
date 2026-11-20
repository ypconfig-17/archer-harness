import { useState } from 'react';
import { Field, FieldDescription, FieldError, FieldLabel, Input } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example({ state = 'default' }: { state?: string }) {
  const [value, setValue] = useState('');
  const invalid = state === 'invalid';
  return (
    <Field>
      <FieldLabel htmlFor="example-input">任务名称</FieldLabel>
      <Input
        id="example-input"
        aria-label="示例输入"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={state === 'disabled'}
        aria-invalid={invalid || undefined}
        placeholder="例如：核对一次类型检查"
      />
      <FieldDescription>
        {invalid ? '名称不能为空，修正后会保留当前输入。' : '仅用于本地展示，不会写入业务设置。'}
      </FieldDescription>
      {invalid && <FieldError>请输入任务名称。</FieldError>}
    </Field>
  );
}
