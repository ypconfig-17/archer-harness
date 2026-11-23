import { Icon } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example() {
  return (
    <div className="example-row">
      <Icon name="file" size="xs" />
      <Icon name="folder" size="sm" />
      <Icon name="terminal" size="md" />
      <Icon name="check" size="lg" />
    </div>
  );
}
