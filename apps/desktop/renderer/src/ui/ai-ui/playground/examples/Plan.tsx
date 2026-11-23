import { useState } from "react";
import { Plan, PlanHistory, Trace, Icon, Button } from "@archer/ui";

/** 完整对话样例只展示固定的计划声明，不从步骤完成推断任务成功。 */
export default function Example({ state = "pending" }: { state?: string }) {
  const [generation, setGeneration] = useState(0);
  const completed = state === "completed";
  const pending = state === "pending";
  return (
    <div className="plan-turn-demo" key={generation}>
      <p className="trace-turn-question">核对当前对话是否符合展示规范。</p>
      <Trace density="compact">
        <Plan
          title="计划：核对当前对话"
          icon={<Icon name="list" size="sm" />}
          defaultOpen
          showProgress={false}
          showStepStatus={false}
          steps={[
            {
              id: "locate",
              text: "定位会话记录与相关文档",
              status: pending ? "pending" : "completed",
            },
            {
              id: "events",
              text: "解析消息与工具事件的展示顺序",
              status: completed ? "completed" : pending ? "pending" : "running",
            },
            {
              id: "interaction",
              text: "核对计划与人工交互的展示边界",
              status: completed ? "completed" : "pending",
            },
            {
              id: "conclusion",
              text: "整理符合项与需要调整的内容",
              status: completed ? "completed" : "pending",
            },
          ]}
        />
        <PlanHistory
          versions={[
            {
              revision: 1,
              title: "核对当前对话",
              steps: [
                {
                  id: "read",
                  text: "定位会话记录与相关文档",
                  status: "completed",
                },
                { id: "check", text: "核对展示边界", status: "running" },
              ],
            },
          ]}
        />
      </Trace>
      <p className="plan-turn-feedback">
        {completed
          ? "计划步骤已声明完成，已整理消息顺序与展示边界的核对结果。具体执行证据仍以工具记录为准。"
          : pending
            ? "计划已准备好，接下来先定位会话记录与设计文档。"
            : "已定位相关记录，正在核对公开反馈与工具活动的实际顺序。"}
      </p>
      <Button variant="secondary" onClick={() => setGeneration((value) => value + 1)}>
        重置示例
      </Button>
    </div>
  );
}
