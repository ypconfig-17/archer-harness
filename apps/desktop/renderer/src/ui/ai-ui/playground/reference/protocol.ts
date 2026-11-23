export type SampleState = "running" | "completed" | "error";
export interface ReferenceConfig {
  type: "archer-reference-config";
  appearance: "light" | "dark";
  state: SampleState;
  tokens: Record<string, string>;
}

// 只允许映射色彩和字体，不接受消息注入样式规则或覆盖组件结构刻度。
export const tokenNames = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "font-sans",
  "font-heading",
  "font-mono",
] as const;

/** 同源文档样板配置校验；这不是 Agent 事件协议。 */
export function isReferenceConfig(value: unknown): value is ReferenceConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<ReferenceConfig>;
  return (
    v.type === "archer-reference-config" &&
    (v.appearance === "light" || v.appearance === "dark") &&
    (v.state === "running" || v.state === "completed" || v.state === "error") &&
    !!v.tokens &&
    typeof v.tokens === "object" &&
    !Array.isArray(v.tokens) &&
    Object.entries(v.tokens).every(
      ([key, item]) =>
        tokenNames.some((name) => name === key) && typeof item === "string",
    )
  );
}
