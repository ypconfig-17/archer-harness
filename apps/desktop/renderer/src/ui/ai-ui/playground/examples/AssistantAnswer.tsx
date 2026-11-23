import { Button } from "@archer/ui";
import { FinalAnswer } from "../../conversation/Content";

/** 与正式答复共用 Markdown 阅读器，示例操作仅存在本地。 */
export default function Example() {
  return (
    <div className="ai-component-demo">
      <FinalAnswer
        text={
          "## 检查结论\n\n已核对公开反馈与工具活动，**局部失败不会被误标为任务失败**。\n\n| 核对项 | 结果 |\n| --- | --- |\n| 消息顺序 | 保持原序 |\n| 计划来源 | 模型声明 |\n\n下一步可以查看 `EventTimeline` 的实际活动详情。"
        }
        results={<p>已核对 2 个文件。</p>}
        actions={<Button variant="secondary" disabled>示例结果入口</Button>}
      />
    </div>
  );
}
