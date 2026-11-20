import { ExecutionNotice } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example({ state = 'default' }: { state?: string }) {
  return (
    <div className="ai-component-demo">
      <ExecutionNotice
        kind={
          state === 'error'
            ? 'error'
            : state === 'blocked'
              ? 'blocked'
              : state === 'unconfirmed'
                ? 'unconfirmed'
                : 'unknown'
        }
        title={
          state === 'error'
            ? '执行失败'
            : state === 'blocked'
              ? '执行受阻'
              : state === 'unconfirmed'
                ? '提交未确认'
                : '外部结果未知'
        }
      >
        <p>保留事实边界，不自动重试。</p>
      </ExecutionNotice>
      <p className="ai-example-note">未知结果不能折叠成确定失败，也不提供默认重试。</p>
    </div>
  );
}
