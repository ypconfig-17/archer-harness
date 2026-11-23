import { useState } from 'react';
import { Button, Icon } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example({ state = 'default' }: { state?: string }) {
  const [count, setCount] = useState(0);
  const disabled = state === 'disabled';
  return (
    <div className="example-stack">
      <div className="example-row">
        <Button
          variant={state === 'destructive' ? 'destructive' : 'default'}
          disabled={disabled}
          onClick={() => setCount(count + 1)}
        >
          <Icon name="spark" size="sm" />
          主要操作
        </Button>
        <Button variant="secondary" disabled={disabled}>次要操作</Button>
        <Button variant="outline" disabled={disabled}>
          描边操作
        </Button>
        <Button variant="ghost" disabled={disabled}>
          轻量操作
        </Button>
      </div>
      <p role="status">已点击 {count} 次；示例只更新本地状态。</p>
    </div>
  );
}
