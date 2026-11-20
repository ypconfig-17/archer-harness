import { useState } from 'react';
import { Confirmation, CodeSnippet } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example({ state = 'default' }: { state?: string }) {
  const [decision, setDecision] = useState<'approved' | 'denied'>();
  return (
    <div className="ai-component-demo">
      <Confirmation
        title="允许读取 Git 状态？"
        decision={decision}
        busy={state === 'busy'}
        onApprove={() => setDecision('approved')}
        onDeny={() => setDecision('denied')}
      >
        <CodeSnippet title="命令" text="git status --short" />
        <p>按钮只改变本地展示，不执行命令。</p>
      </Confirmation>
      <p className="ai-example-note">批准只说明人类决定，不表示命令已经开始或成功。</p>
    </div>
  );
}
