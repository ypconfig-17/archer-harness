import {
  Trace,
  TraceLine,
  TraceIcon,
  TraceTitle,
  TraceDescription,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
  Icon,
  CodeSnippet,
} from "@archer/ui";

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example({ state = "default" }: { state?: string }) {
  return (
    <div className="trace-part-demo">
      <Trace density="compact">
        <TraceLine
          status={
            state === "running"
              ? "running"
              : state === "error"
                ? "error"
                : undefined
          }
        >
          <TraceIcon>
            <Icon name="file" size="sm" />
          </TraceIcon>
          <TraceTitle>
            {state === "error" ? "读取文件失败" : "已读取设计文档"}
          </TraceTitle>
          <TraceDescription>2 个文件</TraceDescription>
        </TraceLine>
        <TraceCollapsible>
          <TraceCollapsibleTrigger>
            <TraceLine>
              <TraceIcon>
                <Icon name="terminal" size="sm" />
              </TraceIcon>
              <TraceTitle>查看调用输出</TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent keepMounted>
            <CodeSnippet title="示例输出" text="检查通过" />
          </TraceCollapsibleContent>
        </TraceCollapsible>
      </Trace>
    </div>
  );
}
