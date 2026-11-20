import { useState } from 'react';
import { Field, FieldDescription, FieldLabel, Textarea } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example({ state = 'default' }: { state?: string }) {
  const [value, setValue] = useState('');
  return (
    <Field>
      <FieldLabel htmlFor="example-textarea">补充说明</FieldLabel>
      <Textarea
        id="example-textarea"
        value={value}
        rows={4}
        disabled={state === 'disabled'}
        aria-invalid={state === 'invalid' || undefined}
        placeholder="写下执行步骤、检查要点和约束…"
        onChange={(event) => setValue(event.target.value)}
      />
      <FieldDescription>
        多行字段与单行输入共享表面、焦点环与错误状态。
      </FieldDescription>
    </Field>
  );
}
