import type { ComponentProps, ReactNode } from "react";
import { Icon } from "../primitives/Icon.js";
import { Spinner } from "./Spinner.js";
import {
  Trace,
  TraceLine,
  TraceIcon,
  TraceTitle,
  TraceDescription,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
} from "./Trace.js";

/** 只组织一轮阅读结构，不推断任务状态，也不订阅外部事实。 */
export function AgentTurn({ children, ...props }: ComponentProps<"section">) {
  return (
    <section
      {...props}
      className={`archer-agent-turn ${props.className ?? ""}`}
    >
      {children}
    </section>
  );
}

/** 图标由宿主通过语义 Icon 注入，避免包依赖桌面应用。 */
export function MessageHeader({
  icon,
  name,
  time,
  actions,
}: {
  icon?: ReactNode;
  name: string;
  time?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="archer-message-header">
      {icon}
      <strong>{name}</strong>
      {time && <time>{time}</time>}
      {actions && <div className="archer-message-actions">{actions}</div>}
    </header>
  );
}

export function ProgressParagraph({ children }: { children: ReactNode }) {
  return <div className="archer-progress-paragraph">{children}</div>;
}

/** 连续区间由宿主投影决定；展开状态由原生 details 保持。 */
export function ActivityGroup({
  title,
  meta,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  meta?: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Trace className="archer-activity-group">
      <TraceCollapsible defaultOpen={defaultOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine>
            {icon && <TraceIcon>{icon}</TraceIcon>}
            <TraceTitle>{title}</TraceTitle>
            {meta && <TraceDescription>{meta}</TraceDescription>}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent keepMounted>
          {children}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

export interface PlanStepView {
  id: string;
  text: string;
  status: "pending" | "running" | "completed";
  icon?: ReactNode;
}

/** 进度只计算传入的声明步骤，不能代表工具验证或任务成功。 */
export function Plan({
  title,
  steps,
  icon,
  defaultOpen = false,
  showProgress = true,
  showStepStatus = true,
  executionStopped = false,
  children,
}: {
  title: string;
  steps: readonly PlanStepView[];
  icon?: ReactNode;
  defaultOpen?: boolean;
  /** 轻量轨迹可省略进度条，完成数仍保留在标题中。 */
  showProgress?: boolean;
  /** 图标已表达局部状态时，可省略重复的状态文字。 */
  showStepStatus?: boolean;
  /** 宿主已结束执行时停止动画，不改写模型声明的步骤进度。 */
  executionStopped?: boolean;
  /** 修订记录等补充内容与步骤共用同一个展开入口。 */
  children?: ReactNode;
}) {
  const completed = steps.filter((step) => step.status === "completed").length;
  return (
    <Trace
      className={`archer-plan${steps.length > 0 && completed === steps.length ? " is-completed" : ""}`}
    >
      <TraceCollapsible defaultOpen={defaultOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine>
            {icon && <TraceIcon>{icon}</TraceIcon>}
            <TraceTitle>{title}</TraceTitle>
            <TraceDescription>{`${completed}/${steps.length} · 模型声明`}</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent keepMounted>
          {showProgress && steps.length > 0 && (
            <progress
              aria-label="声明步骤完成数"
              value={completed}
              max={steps.length}
            />
          )}
          <Trace aria-label="计划声明步骤">
            {steps.map((step) => (
              <TraceLine
                key={step.id}
                data-plan-status={executionStopped && step.status === "running" ? "stopped" : step.status}
                status={executionStopped || step.status === "completed" ? undefined : step.status}
              >
                <TraceIcon>
                  {step.icon ??
                    (step.status === "completed" ? (
                      <Icon name="check" size="sm" />
                    ) : step.status === "running" && !executionStopped ? (
                      <Spinner label="进行中" />
                    ) : (
                      <Icon name="clock" size="sm" />
                    ))}
                </TraceIcon>
                <TraceTitle title={step.text}>{step.text}</TraceTitle>
                {showStepStatus && (
                  <TraceDescription>
                    {step.status === "completed"
                      ? "已完成"
                      : step.status === "running"
                        ? executionStopped ? "已停止" : "进行中"
                        : "待处理"}
                  </TraceDescription>
                )}
              </TraceLine>
            ))}
          </Trace>
          {children}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

/** 授权、问答和对账动作由宿主提供，本组件不实现权限策略。 */
export function InteractionCard({
  title,
  icon,
  meta,
  children,
  actions,
}: {
  title: string;
  icon?: ReactNode;
  /** 模式标记、命令类别等标题侧信息，不承载权限判断。 */
  meta?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="archer-interaction">
      <header>
        {icon}
        <strong>{title}</strong>
        {meta}
      </header>
      <div>{children}</div>
      {actions && <footer>{actions}</footer>}
    </section>
  );
}
