import { useState } from 'react';
import { DialogHeader } from '@archer/ui';
export default function Example({ state = 'default' }: { state?: string }) {
  const [closed, setClosed] = useState(false);
  return (
    <>
      <DialogHeader
        title="说明标题"
        description="标题与关闭动作共享标准布局。"
        closeDisabled={state === 'disabled'}
        onClose={() => setClosed(true)}
      />
      <p role="status">{closed ? '已触发关闭回调' : '等待操作'}</p>
    </>
  );
}
