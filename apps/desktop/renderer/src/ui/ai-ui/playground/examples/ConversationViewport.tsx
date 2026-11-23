import { useState } from 'react';
import { ConversationViewport, Button } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example() {
  const [rows, setRows] = useState(18);
  return (
    <>
      <Button variant="secondary" onClick={() => setRows(rows + 1)}>追加一条</Button>
      <div className="example-viewport">
        <ConversationViewport>
          {Array.from({ length: rows }, (_, index) => (
            <p key={index}>消息 {index + 1} · 向上阅读时不强制跟随</p>
          ))}
        </ConversationViewport>
      </div>
    </>
  );
}
