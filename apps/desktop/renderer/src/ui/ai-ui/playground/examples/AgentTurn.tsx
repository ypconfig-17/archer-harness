import { AgentTurn, Message, MessageHeader, ProgressParagraph } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example() {
  return (
    <div className="ai-component-demo">
      <AgentTurn>
        <Message role="user">检查工作区</Message>
        <MessageHeader name="Archer" time="10:24" />
        <ProgressParagraph>先读取现有记录，再进行核对。</ProgressParagraph>
      </AgentTurn>
      <p className="ai-example-note">公开内容由宿主投影，组件不生成阶段或结果。</p>
    </div>
  );
}
