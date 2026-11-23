import { useLayoutEffect, useRef, type ReactNode } from "react";
import { traceStream } from "../../../lib/stream-diagnostics";
import { AssistantAnswer, ProgressParagraph } from "@archer/ui";
import { Markdown } from "../../primitives/Markdown";

/** 公开反馈共用正文渲染入口，临时标识由调用方根据来源显式提供。 */
export function PublicFeedback({
  text,
  preview,
  streaming = false,
  effectId,
}: {
  text: string;
  preview?: string;
  streaming?: boolean;
  effectId?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  // 布局 Effect 表示本次 React DOM 提交，不能等同于屏幕已经绘制。
  useLayoutEffect(() => {
    if (effectId) traceStream('UI Commit', effectId, text.length, streaming ? 'generating' : 'static', root.current?.textContent?.length);
  }, [effectId, text, streaming]);
  return (
    <div className="progress-paragraph" ref={root}>
      <ProgressParagraph>
        {/* 临时正文显式启用流式渲染；已提交与中断内容立即完整显示。 */}
        <Markdown text={text} streaming={streaming} />
      </ProgressParagraph>
      {preview && (
        <small
          className="progress-preview-state"
          title="临时正文尚未提交为正式事实"
        >
          {preview}
        </small>
      )}
    </div>
  );
}

/** 正式消息与示例只换内容，不维护第二份标题、表格、代码或操作区排版。 */
export function FinalAnswer({
  text,
  actions,
  results,
}: {
  text: string;
  actions?: ReactNode;
  results?: ReactNode;
}) {
  return (
    <AssistantAnswer actions={actions} results={results}>
      <Markdown text={text} />
    </AssistantAnswer>
  );
}
