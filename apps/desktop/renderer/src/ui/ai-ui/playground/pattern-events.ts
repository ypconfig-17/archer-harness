import type { TimelineEvent } from "../../../lib/conversation";

export type PatternScene =
  "no-plan" | "running" | "completed" | "confirmation" | "failed" | "history";
type TurnFact = Extract<TimelineEvent["fact"], { scope: "turn" }>["event"];
const baseTime = Date.UTC(2026, 0, 1, 10, 24);
const target = {
  providerId: "preview",
  capabilityId: "read",
  contractId: "archer.tool@1",
  revision: "preview",
};

/** 固定展示夹具只送入纯投影，不提交 Journal、不调用 Provider，不代表真实运行。 */
export function patternEvents(
  scene: PatternScene,
  answered: boolean,
): TimelineEvent[] {
  const facts: { type: string; data: unknown }[] = [];
  const infer = (id: string, content: string) =>
    facts.push(
      {
        type: "effect.created",
        data: {
          effectId: id,
          createdAt: baseTime,
          effect: {
            type: "INFER",
            target: { ...target, contractId: "archer.inference@1" },
            messages: [],
            promptPrefixCount: 0,
          },
        },
      },
      {
        type: "effect.completed",
        data: {
          effectId: id,
          effectType: "INFER",
          result: { content },
          finishedAt: baseTime + 1000,
        },
      },
    );
  const call = (id: string, input: unknown) =>
    facts.push({
      type: "effect.created",
      data: {
        effectId: id,
        createdAt: baseTime + 1000,
        effect: { type: "CALL", target, input, ...(id === "ask" ? { interaction: "human" } : {}) },
      },
    });
  const done = (id: string, value: unknown) =>
    facts.push({
      type: "effect.completed",
      data: {
        effectId: id,
        effectType: "CALL",
        result: { value },
        finishedAt: baseTime + 2000,
        durationMs: 1000,
      },
    });
  const plan = (
    id: string,
    revision: number,
    complete: boolean,
    planId = "preview-plan",
  ) => {
    call(id, {});
    done(id, {
      metadata: {
        plan: {
          planId,
          revision,
          title: "核对消息与执行活动",
          steps: ["读取展示规范", "核对事件顺序", "整理检查结论"].map(
            (text, index) => ({
              text,
              status:
                complete || index === 0
                  ? "completed"
                  : index === 1
                    ? "in_progress"
                    : "pending",
            }),
          ),
        },
      },
    });
  };
  facts.push({
    type: "turn.created",
    data: { createdAt: baseTime, allowShell: false },
  });
  infer(
    "feedback-1",
    "我先读取展示规范，再核对公开反馈、工具活动与人工交互的实际顺序。",
  );
  call("read-1", { path: "/preview/desktop-ui-spec.md" });
  done("read-1", { content: "固定演示文档内容。" });
  if (scene !== "no-plan") plan("plan-1", 1, false);
  infer(
    "feedback-2",
    "已读取展示规范。接下来检查消息边界，计划进度只表示模型声明。",
  );
  if (scene === "confirmation") {
    call("ask", {
      reason: "历史记录不完整，是否继续核对已加载内容？",
      options: ["继续核对", "停止检查"],
    });
    facts.push({
      type: "effect.suspended",
      data: { effectId: "ask", reason: "等待你的回答" },
    });
    if (answered) {
      facts.push({
        type: "effect.resumed",
        data: { effectId: "ask", kind: "human" },
      });
      done("ask", { approved: true, response: "继续核对" });
      infer("feedback-3", "按你的选择，继续核对已加载内容。");
    }
  } else if (scene === "failed") {
    call("write", { path: "/preview/report.md", content: "示例报告" });
    facts.push({
      type: "effect.failed",
      data: {
        effectId: "write",
        effectType: "CALL",
        error: { message: "示例：目录不可写。" },
        finishedAt: baseTime + 3000,
      },
    });
    infer("feedback-3", "报告写入失败，已保留检查结果，尚未自动重试。");
  } else {
    call("read-2", { path: "/preview/events.ts" });
    if (scene !== "running") done("read-2", { content: "固定事件定义。" });
  }
  if (scene === "history") {
    plan("plan-2", 2, true);
    infer("feedback-3", "第一份计划已声明完成，继续核对恢复边界。");
    plan("plan-3", 1, false, "preview-plan-second");
  }
  if (scene === "completed") {
    plan("plan-2", 2, true);
    const answer =
      "## 检查结论\n\n已完成本示例的展示核对。\n\n| 检查项 | 结果 |\n| --- | --- |\n| 消息与活动顺序 | 保持原序 |\n| 计划状态 | 模型声明 |\n\n未将计划完成冒充外部执行验证。";
    infer("answer", answer);
    facts.push({
      type: "turn.completed",
      data: { completedAt: baseTime + 4000, summary: answer },
    });
  }
  // 仅构造展示所需的固定快照；不会通过 API 提交或被 Runtime 执行。
  return facts.map((event, index) => ({
    id: `preview:${index + 1}`,
    agentId: "preview",
    seq: index + 1,
    ts: baseTime + index,
    fact: {
      scope: "turn",
      turnId: "preview:t1",
      turnSeq: index + 1,
      event: event as TurnFact,
    },
  }));
}
