import { FloatingSurface } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example() {
  return (
    <FloatingSurface className="example-surface">
      浮层表面只提供外观；定位由 Popover 或宿主负责。
    </FloatingSurface>
  );
}
