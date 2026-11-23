/** 容量线命中后只节选可从已提交历史读回的工具正文，原始事实与调用配对保持完整。 */
import type { InferEffect } from '@archer/contracts';
import type { HandlerContext } from './pipeline.js';
import { measureWindow } from './context-window.js';

/** 收益按完整输入比较；单条正文最多保留 4096 个估算 token，且不超过输入额度的四分之一，两者独立。 */
export function boundToolResults(effect: InferEffect, context: HandlerContext, minSavingsRatio = 0.25): InferEffect {
  const window = measureWindow(effect, context.inference);
  const historyTool = effect.tools?.find(tool =>
    tool.target.providerId === 'history' && tool.target.capabilityId === 'read');
  if (!window || window.estimatedInputTokens <= Math.floor(window.inputLimit * 0.85) || !context.history
    || !historyTool) return effect;

  const minimumSavings = Math.ceil(window.estimatedInputTokens * minSavingsRatio);
  const excerptBudget = Math.min(4096, Math.floor(window.inputLimit / 4));
  let projected = effect;
  const candidates = effect.messages
    .map((message, index) => ({ message, index }))
    .filter(({ message, index }) => index >= effect.promptPrefixCount && message.role === 'tool' && message.toolCallId)
    .sort((left, right) => right.message.content.length - left.message.content.length);

  for (const { message, index } of candidates) {
    let page;
    try {
      page = context.history.read({ callId: message.toolCallId!, limit: 2 });
    } catch {
      // 不猜测歧义或不可访问的历史来源，继续由窗口准入明确拒绝。
      continue;
    }
    if (page.totalChars !== message.content.length || !message.content.startsWith(page.content)) continue;
    const readInput = { turnId: page.turnId, callId: page.callId, offset: 0, limit: 4096 };
    const argumentsForRead = historyTool.wrappedInput ? { input: readInput } : readInput;
    const notice = `\n[Tool output excerpt; full committed output has ${page.totalChars} UTF-16 characters. Read omitted evidence with ${historyTool.name} ${JSON.stringify(argumentsForRead)}. Do not infer omitted content or task success.]`;
    const empty = {
      ...projected,
      messages: projected.messages.map((value, position) => position === index
        ? { ...value, content: notice }
        : value),
    };
    const fixed = measureWindow(empty, context.inference);
    if (!fixed || fixed.method !== window.method) continue;
    const current = measureWindow(projected, context.inference);
    if (!current || current.estimatedInputTokens - fixed.estimatedInputTokens <= excerptBudget) continue;
    const allowance = Math.max(0, Math.min(excerptBudget, window.inputLimit - fixed.estimatedInputTokens));
    let low = 0;
    let high = message.content.length - 1;
    let selected: InferEffect | undefined;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      let end = middle;
      const code = message.content.charCodeAt(end - 1);
      if (code >= 0xD800 && code <= 0xDBFF) end--;
      const candidate = {
        ...projected,
        messages: projected.messages.map((value, position) => position === index
          ? { ...value, content: message.content.slice(0, end) + notice }
          : value),
      };
      const measured = measureWindow(candidate, context.inference);
      if (!measured || measured.method !== window.method) return effect;
      if (measured.estimatedInputTokens - fixed.estimatedInputTokens <= allowance) {
        selected = candidate;
        low = middle + 1;
      } else high = middle - 1;
    }
    if (selected) projected = selected;
    const after = measureWindow(projected, context.inference);
    if (after && after.estimatedInputTokens <= after.inputLimit
      && window.estimatedInputTokens - after.estimatedInputTokens >= minimumSavings) break;
  }
  const after = measureWindow(projected, context.inference);
  // 多条结果共同达到收益门槛才采用；未达标时不把部分节选泄漏给后续步骤。
  return after && window.estimatedInputTokens - after.estimatedInputTokens >= minimumSavings
    ? projected
    : effect;
}
