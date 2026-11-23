/**
 * 来源 URL 只允许 http/https。
 * 组件是展示层，不能把 javascript: 等未知协议渲染成可点击入口；
 * 不安全的地址仍由调用方保留文字，以便阅读原始来源。
 */
export function safeHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}
