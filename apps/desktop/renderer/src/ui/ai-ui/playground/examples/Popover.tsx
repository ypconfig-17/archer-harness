import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Popover,
} from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>样式来源</CardTitle>
        <CardDescription>浮层只提供表面，关闭与定位由入口管理。</CardDescription>
      </CardHeader>
      <CardContent>
        <p>点击查看说明，按 Esc 或点击外部关闭。</p>
      </CardContent>
      <CardFooter>
        <Popover label="查看说明">
          <p>浮层不读取业务数据，也不执行命令。</p>
        </Popover>
      </CardFooter>
    </Card>
  );
}
