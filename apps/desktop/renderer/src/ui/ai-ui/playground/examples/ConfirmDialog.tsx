import { useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ConfirmDialog,
} from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState('尚未选择');
  return (
    <div className="ai-component-demo">
      <Card>
        <CardHeader>
          <CardTitle>删除会话记录</CardTitle>
          <CardDescription>确认框默认聚焦取消，Esc 只关闭当前确认。</CardDescription>
        </CardHeader>
        <CardContent>
          <p>确认操作只更新本页状态，不删除真实数据。</p>
        </CardContent>
        <CardFooter>
          <Button variant="secondary" onClick={() => setOpen(true)}>打开确认框</Button>
          <span className="ai-example-note" role="status">
            {result}
          </span>
        </CardFooter>
      </Card>
      {open && (
        <ConfirmDialog
          title="确认演示操作？"
          description="不会删除或提交真实数据。"
          confirmLabel="确认"
          onClose={() => setOpen(false)}
          onConfirm={() => {
            setResult('已确认演示');
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
