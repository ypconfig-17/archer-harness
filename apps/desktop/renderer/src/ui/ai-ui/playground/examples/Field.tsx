import { useState } from 'react';
import { Field, FieldLabel, FieldDescription, FieldError, FieldGroup, Input } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example({ state = 'default' }: { state?: string }) {
  const [value, setValue] = useState('');
  const invalid = state === 'invalid' && !value;
  return (
    <FieldGroup title="连接示例">
      <Field>
        <FieldLabel htmlFor="example-field">名称</FieldLabel>
        <Input
          id="example-field"
          placeholder="例如：工作区名称"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={invalid}
          aria-describedby={invalid ? 'field-help field-error' : 'field-help'}
        />
        <FieldDescription id="field-help">填写后错误消失。</FieldDescription>
        {invalid && <FieldError id="field-error">请输入名称</FieldError>}
      </Field>
    </FieldGroup>
  );
}
