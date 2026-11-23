import { useState } from "react";
import {
  Button,
  CodeSnippet,
  Icon,
  Trace,
  TraceLine,
  TraceIcon,
  TraceTitle,
  TraceDescription,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
} from "@archer/ui";

/** 完整语境用于展示组合节奏；所有执行记录为固定演示，不触发真实调用。 */
export default function Example({ state = "default" }: { state?: string }) {
  const [replay, setReplay] = useState(0);
  const running = state === "running";
  const failed = state === "error";
  return (
    <div className="trace-turn-demo" key={replay}>
      <p className="trace-turn-question">为什么 CI 中的依赖安装失败了？</p>
      <Trace density="compact">
        <TraceLine>
          <TraceIcon>
            <Icon name="check" size="sm" />
          </TraceIcon>
          <TraceTitle>已检查项目配置</TraceTitle>
          <TraceDescription>2 个文件</TraceDescription>
        </TraceLine>
        <TraceCollapsible>
          <TraceCollapsibleTrigger>
            <TraceLine>
              <TraceIcon>
                <Icon name="terminal" size="sm" />
              </TraceIcon>
              <TraceTitle>运行 pnpm --version</TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent keepMounted>
            <CodeSnippet title="版本输出" text="11.25.0" />
          </TraceCollapsibleContent>
        </TraceCollapsible>
        <TraceCollapsible defaultOpen>
          <TraceCollapsibleTrigger>
            <TraceLine>
              <TraceIcon>
                <Icon name="check" size="sm" />
              </TraceIcon>
              <TraceTitle>检查 package.json 与锁文件的变更</TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent keepMounted>
            <CodeSnippet
              title="锁文件差异"
              text={
                "package.json | 2 +-\n1 file changed, 1 insertion(+), 1 deletion(-)"
              }
            />
          </TraceCollapsibleContent>
        </TraceCollapsible>
        <TraceCollapsible>
          <TraceCollapsibleTrigger>
            <TraceLine
              status={running ? "running" : failed ? "error" : undefined}
            >
              <TraceIcon>
                <Icon
                  name={failed ? "alert" : running ? "clock" : "check"}
                  size="sm"
                />
              </TraceIcon>
              <TraceTitle>
                {running
                  ? "正在核对依赖版本"
                  : failed
                    ? "pnpm install --frozen-lockfile 执行失败"
                    : "已确认依赖与锁文件不一致"}
              </TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent keepMounted>
            <CodeSnippet
              title="诊断输出"
              text={
                running
                  ? "检查尚在进行中。"
                  : "示例诊断：package.json 已更新，pnpm-lock.yaml 未同步。"
              }
            />
          </TraceCollapsibleContent>
        </TraceCollapsible>
      </Trace>
      <div className="trace-turn-answer">
        <p>
          {running
            ? "已经定位到依赖清单的变更，正在核对锁文件；尚未形成最终结论。"
            : "最近一次提交更新了 package.json 中的版本，但未同步 pnpm-lock.yaml，因此冻结锁文件的安装检查无法通过。请在本地更新锁文件后一起提交。"}
        </p>
      </div>
      <Button variant="secondary" onClick={() => setReplay((value) => value + 1)}>重置示例</Button>
    </div>
  );
}
