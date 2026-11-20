import { InteractionRecord } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example() {
  return (
    <div className="ai-component-demo">
      <InteractionRecord title="已回答 · 继续检查">
        <p>原问题：是否继续检查？</p>
        <p>回答：继续检查。</p>
      </InteractionRecord>
      <p className="ai-example-note">记录保留原始问题和回答，默认折叠在原位置。</p>
    </div>
  );
}
