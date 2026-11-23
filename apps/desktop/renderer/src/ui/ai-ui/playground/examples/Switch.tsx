import { useState } from 'react';
import { Switch } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example({ state = 'default' }: { state?: string }) {
  const [checked, setChecked] = useState(state === 'checked');
  return (
    <div className="example-row">
      <Switch
        label="启用示例选项"
        checked={checked}
        disabled={state === 'disabled'}
        onCheckedChange={setChecked}
      />
      <span>{checked ? '已启用' : '已关闭'}</span>
    </div>
  );
}
