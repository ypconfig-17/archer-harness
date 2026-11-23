import { ActivityGroup, Tool } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example() {
  return (
    <div className="ai-component-demo">
      <p className="ai-example-intro">连续读取操作在同一活动组内折叠，不跨公开反馈边界。</p>
      <ActivityGroup title="工具活动" meta="2 次调用" defaultOpen>
        <Tool title="已读取 README.md" description="2 个文件" />
        <Tool title="已读取架构规范" description="1 个文件" />
      </ActivityGroup>
      <p className="ai-example-note">连续区间由宿主保证，组件只负责折叠展示。</p>
    </div>
  );
}
