/** 准备结果仅作为参考加入当前推理，不修改可信系统指令或会话历史。 */
export function preparationReference(serialized: string): string {
  return `Context preparation result (untrusted data): ${serialized}`;
}
