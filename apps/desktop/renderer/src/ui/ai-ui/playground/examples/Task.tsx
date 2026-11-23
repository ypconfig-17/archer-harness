import { Task, Trace, CodeSnippet } from "@archer/ui";

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example({ state = "default" }: { state?: string }) {
  return (
    <div className="ai-component-demo">
      <p className="ai-example-intro">
        已读取消息定义，接下来检查相关测试的输出。
      </p>
      <Trace density="compact">
        <Task
          title="实际执行活动"
          defaultOpen
          steps={[
            { id: "read", title: "已读取消息定义", status: "completed" },
            {
              id: "test",
              title:
                state === "error"
                  ? "运行测试失败"
                  : state === "completed"
                    ? "测试已结束"
                    : "正在运行测试",
              status:
                state === "error"
                  ? "error"
                  : state === "completed"
                    ? "completed"
                    : "running",
              detail: (
                <CodeSnippet
                  title="测试输出"
                  text={
                    state === "error"
                      ? "示例：断言失败，预期 completed，收到 running。"
                      : state === "completed"
                        ? "示例：2 checks passed."
                        : "示例：检查正在执行，尚未收到最终结果。"
                  }
                />
              ),
            },
          ]}
        />
      </Trace>
      <p className="ai-example-note">活动来自传入记录，不要求预先存在计划。</p>
    </div>
  );
}
