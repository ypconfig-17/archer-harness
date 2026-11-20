import { TurnSummary } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example({ state = 'default' }: { state?: string }) {
  return (
    <div className="ai-component-demo">
      <p className="ai-example-intro">本轮完成 4 次工具调用后，宿主给出明确的结束事实。</p>
      <TurnSummary
        status={
          state === 'completed'
            ? 'completed'
            : state === 'waiting'
              ? 'waiting-approval'
              : 'running'
        }
        calls={4}
        duration="12 秒"
        attention={state === 'completed' ? '1 项未知结果待核查' : undefined}
      />
      <p className="ai-example-note">主状态与需关注项分别表达，等待授权不冒充完成。</p>
    </div>
  );
}
