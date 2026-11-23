import { Spinner } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example({ state = 'default' }: { state?: string }) {
  return (
    <div className="example-row">
      <Spinner size="sm" label="正在处理" />
      <span>{state === 'done' ? '已完成，不再显示旋转指示' : '正在处理…'}</span>
      {state !== 'done' && <Spinner size="xs" />}
    </div>
  );
}
