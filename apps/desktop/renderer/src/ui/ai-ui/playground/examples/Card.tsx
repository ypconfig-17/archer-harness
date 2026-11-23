import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Icon,
} from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example({ state = 'default' }: { state?: string }) {
  return (
    <Card size={state === 'sm' ? 'sm' : 'default'}>
      <CardHeader>
        <CardTitle>资源设置</CardTitle>
        <CardDescription>组合式表面，标题、正文与动作保持独立层级。</CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" aria-label="更多设置">
            <Icon name="more" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="example-facts">
          <li>工作目录 · 当前项目</li>
          <li>文件访问 · 只读</li>
          <li>变更范围 · 3 个文件</li>
        </ul>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="outline">取消</Button>
        <Button variant="default">保存设置</Button>
      </CardFooter>
    </Card>
  );
}
