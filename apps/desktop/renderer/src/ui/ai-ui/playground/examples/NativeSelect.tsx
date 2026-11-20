import { useState } from 'react';
import { NativeSelect } from '@archer/ui';

/** 原生选择器只用于仍依赖 base-select 行为的密集表单。 */
export default function Example({ state = 'default' }: { state?: string }) {
  const [value, setValue] = useState('local');
  return (
    <div className="example-control">
      <NativeSelect
        aria-label="示例来源"
        value={value}
        disabled={state === 'disabled'}
        onChange={(event) => setValue(event.target.value)}
      >
        <option value="local">本地目录</option>
        <option value="remote">远程来源</option>
      </NativeSelect>
    </div>
  );
}
