import { useState } from 'react';
import { Terminal, Button } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example({ state = 'default' }: { state?: string }) {
  const [output, setOutput] = useState('准备检查…');
  return (
    <div className="ai-component-demo">
      <div className="ai-example-actions">
        <Button variant="secondary" onClick={() => setOutput((value) => value + '\n收到一行演示输出')}>
          追加输出
        </Button>
      </div>
      <Terminal
        command="pnpm typecheck"
        output={output}
        status={
          state === 'error'
            ? 'error'
            : state === 'unknown'
              ? 'unknown'
              : state === 'completed'
                ? 'completed'
                : 'running'
        }
      />
      <p className="ai-example-note">组件只阅读命令与输出，不执行 Shell 或推断成功。</p>
    </div>
  );
}
