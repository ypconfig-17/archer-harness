import { useState } from 'react';
import { Message, MessageHeader, Button } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example({ state = 'default' }: { state?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="ai-component-demo">
      <Message
        role={state === 'user' ? 'user' : 'assistant'}
        header={<MessageHeader name={state === 'user' ? '用户' : 'Archer'} time="10:24" />}
        actions={
          <Button variant="ghost" onClick={() => setCopied(true)}>
            {copied ? '已触发示例操作' : '示例操作'}
          </Button>
        }
      >
        我先检查公开反馈和执行活动的展示，再确认最终答复。
      </Message>
      <p className="ai-example-note">组件只组织公开内容，不读取推理或生成结论。</p>
    </div>
  );
}
