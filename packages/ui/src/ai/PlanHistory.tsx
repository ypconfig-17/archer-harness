import { Icon } from "../primitives/Icon.js";
import type { PlanStepView } from "./elements.js";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
  TraceLine,
  TraceIcon,
  TraceTitle,
  TraceDescription,
} from "./Trace.js";

export interface PlanVersionView {
  revision: number;
  title: string;
  steps: readonly PlanStepView[];
}

/** 版本只展示宿主声明的快照，不猜测步骤身份或生成不存在的阶段变化。 */
export function PlanHistory({
  versions,
}: {
  versions: readonly PlanVersionView[];
}) {
  if (!versions.length) return null;
  return (
    <Trace density="compact" className="ui-plan-history">
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <Icon name="clock" size="sm" />
            </TraceIcon>
            <TraceTitle>计划更新记录</TraceTitle>
            <TraceDescription>{versions.length} 个版本</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent keepMounted>
          <Trace>
            {versions.map((version) => {
              const completed = version.steps.filter(
                (step) => step.status === "completed",
              ).length;
              return (
                <TraceCollapsible key={version.revision}>
                  <TraceCollapsibleTrigger>
                    <TraceLine>
                      <TraceTitle>第 {version.revision} 版</TraceTitle>
                      <TraceDescription>
                        {completed}/{version.steps.length} 步完成
                      </TraceDescription>
                    </TraceLine>
                  </TraceCollapsibleTrigger>
                  <TraceCollapsibleContent keepMounted>
                    <p className="ui-plan-version-title">{version.title}</p>
                    <ol className="ui-plan-version-steps">
                      {version.steps.map((step) => (
                        <li key={step.id}>
                          <Icon
                            name={
                              step.status === "completed" ? "check" : "clock"
                            }
                            size="sm"
                          />
                          <span>{step.text}</span>
                          <small>
                            {step.status === "completed"
                              ? "已完成"
                              : step.status === "running"
                                ? "进行中"
                                : "待处理"}
                          </small>
                        </li>
                      ))}
                    </ol>
                  </TraceCollapsibleContent>
                </TraceCollapsible>
              );
            })}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
