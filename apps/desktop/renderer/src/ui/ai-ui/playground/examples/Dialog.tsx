import { useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Dialog,
  DialogActions,
  FormField,
  Input,
} from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('优化 Skills 加载');
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>编辑说明</CardTitle>
          <CardDescription>打开对话框后修改本地草稿，关闭不会保存。</CardDescription>
        </CardHeader>
        <CardContent>
          <p>当前说明：{value}</p>
        </CardContent>
        <CardFooter>
          <Button variant="secondary" onClick={() => setOpen(true)}>打开对话框</Button>
        </CardFooter>
      </Card>
      {open && (
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title="编辑说明"
          description="支持 Esc 关闭并返回触发按钮。"
          actions={
            <DialogActions>
              <Button variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button variant="default" onClick={() => setOpen(false)}>保存</Button>
            </DialogActions>
          }
        >
          <FormField label="说明">
            <Input
              aria-label="说明"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </FormField>
        </Dialog>
      )}
    </>
  );
}
