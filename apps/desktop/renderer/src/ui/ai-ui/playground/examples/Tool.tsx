import { Trace, Tool, CodeSnippet } from "@archer/ui";

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example({ state = "default" }: { state?: string }) {
  return (
    <div className="ai-component-demo">
      <p className="ai-example-intro">
        检查项目的类型定义，并保留命令输出以便核对。
      </p>
      <Trace density="compact">
        <Tool
          title={
            state === "error"
              ? "命令执行失败"
              : state === "running"
                ? "正在执行类型检查"
                : state === "unknown"
                  ? "执行结果未知，请核查"
                  : "已执行类型检查"
          }
          status={state === "running" || state === "error" ? state : undefined}
          description="示例调用"
          defaultOpen={state === "running"}
        >
          <CodeSnippet
            title="输出"
            text={
              state === "error"
                ? "目标目录不可写"
                : state === "unknown"
                  ? "未收到确定结果"
                  : "固定演示输出"
            }
          />
        </Tool>
      </Trace>
      <p className="ai-example-note">
        {state === "unknown"
          ? "尚未收到确定结果，需要核查后再决定下一步。"
          : state === "error"
            ? "本次调用失败；这不等于整轮任务失败。"
            : state === "running"
              ? "当前调用仍在进行中，可展开查看已收到的输出。"
              : "调用输出已收到，可展开核对详情。"}
      </p>
    </div>
  );
}
