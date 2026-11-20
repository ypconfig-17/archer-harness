import { Button, Tooltip } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example() {
  return (
    <div className="example-row">
      <Tooltip label="查看执行记录">
        <Button variant="ghost" size="icon" aria-label="查看执行记录">
          <span aria-hidden="true">·</span>
        </Button>
      </Tooltip>
    </div>
  );
}
