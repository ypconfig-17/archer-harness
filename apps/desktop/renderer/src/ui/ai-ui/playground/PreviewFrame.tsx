import type { ReactNode } from "react";
import type { Category } from "./catalog";
import "./preview-frame.css";

type PreviewLayout = "component" | "reading" | "workspace";

/** 只在此处选择展示比例，示例不再自行定义画布宽度和内外留白。 */
export function previewLayout(category: Category): PreviewLayout {
  if (category === "Patterns") return "workspace";
  if (category === "Renderers") return "reading";
  return "component";
}

/** 所有目录页共用画布、状态栏和说明；组件内部视觉仍来自真实组件库。 */
export function PreviewFrame({
  name,
  category,
  controls,
  children,
}: {
  name: string;
  category: Category;
  controls: ReactNode;
  children: ReactNode;
}) {
  const layout = previewLayout(category);
  return (
    <div className="preview-frame" data-layout={layout}>
      <div className="preview-frame-toolbar">
        <div className="preview-frame-controls">{controls}</div>
        <span>交互预览</span>
      </div>
      <div
        className="explorer-preview preview-frame-canvas"
        aria-label={`${name} 组件预览`}
      >
        <div className="preview-frame-content">{children}</div>
      </div>
      <p className="preview-frame-caption">
        固定示例 · 交互仅改变本页状态，不执行命令、不授予权限、不保存业务设置。
      </p>
    </div>
  );
}
