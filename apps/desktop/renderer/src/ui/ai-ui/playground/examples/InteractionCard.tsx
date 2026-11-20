import { useState } from 'react';
import { InteractionCard, Button } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example() {
  const [answer, setAnswer] = useState('');
  return (
    <InteractionCard
      title="需要你的回答"
      actions={<Button variant="default" onClick={() => setAnswer('继续检查')}>继续检查</Button>}
    >
      <p>是否继续核对已加载的记录？</p>
      <p role="status">{answer}</p>
    </InteractionCard>
  );
}
