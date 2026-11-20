import { useState } from "react";
import { Reasoning, Button, Trace } from "@archer/ui";

/** 示例内容为明确允许展示的固定文本，不读取或改写内部推理。 */
export default function Example({ state = "default" }: { state?: string }) {
  const [text, setText] = useState(
    "示例公开记录：先核对组件来源，再检查主题映射与展示边界。",
  );
  return (
    <div className="ai-component-demo">
      <p className="ai-example-intro">
        以下仅展示已获准公开的记录；原始内部推理不进入示例。
      </p>
      <Trace density="compact">
        <Reasoning text={text} running={state === "running"} />
      </Trace>
      <div className="ai-example-actions">
        <Button variant="secondary"
          onClick={() =>
            setText(
              (value) => `${value}\n示例公开记录：继续检查局部组件的组合方式。`,
            )
          }
        >
          追加示例片段
        </Button>
      </div>
      <p className="ai-example-note">
        运行时默认展开；用户手动折叠后，追加内容不强制打开。
      </p>
    </div>
  );
}
