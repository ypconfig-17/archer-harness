/** 摘要分段只选择完整工具调用边界；一次 INFER 内有界处理，避免递归压缩。 */
import { canonicalJson, ContextHandoffUnavailable, OperationRejected, validateContextHandoff, type InferEffect, type InferResult, type Message, type ReasoningLevel } from '@archer/contracts';
import type { SessionCompaction } from '@archer/agent';
import type { HandlerContext } from './pipeline.js';
import { measureWindow } from './context-window.js';
import { COMPACTION_INSTRUCTIONS } from './prompt/compaction.js';

function boundaries(messages: readonly Message[]): number[] {
  const pending = new Set<string>();
  const cuts: number[] = [];
  for (let index = 0; index < messages.length; index++) {
    for (const call of messages[index]!.toolCalls ?? []) pending.add(call.id);
    if (messages[index]!.role === 'tool') pending.delete(messages[index]!.toolCallId ?? '');
    if (!pending.size) cuts.push(index + 1);
  }
  return cuts;
}

export function planCompaction(
  effect: InferEffect,
  context: HandlerContext,
  recentTargetTokens: number,
  previous?: SessionCompaction,
  prepared: InferEffect = effect,
  options: { summaryBudgetTokens?: number; reasoning?: ReasoningLevel } = {},
) {
  const history = effect.messages.slice(effect.promptPrefixCount);
  const start = previous?.coveredMessageCount ?? 0;
  const firstReplaceable = history.findIndex((message, index) => index >= start && (message.role === 'assistant' || message.role === 'tool'));
  if (firstReplaceable < 0) return null;
  if (!context.inference.measure) return null;
  const measurement = context.inference.measure(prepared);
  if (!measurement) return null;
  const prefix = prepared.messages.slice(0, prepared.promptPrefixCount);
  const prefixMeasurement = context.inference.measure({ ...prepared, messages: prefix });
  if (!prefixMeasurement) return null;
  const prefixTokens = prefixMeasurement.estimatedInputTokens;
  const preparedWindow = measureWindow(prepared, context.inference);
  if (!preparedWindow) return null;
  const protectedTokens = Math.min(recentTargetTokens, Math.max(0, preparedWindow.inputLimit - prefixTokens));
  const cuts = boundaries(history).filter(cut => cut > firstReplaceable && cut < history.length);
  // 只在合法批次边界计量尾部；二分寻找仍保留目标体积的最晚边界。
  let low = 0;
  let high = cuts.length - 1;
  let lastKept = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const retained = history.slice(0, cuts[middle]!).filter(message => message.role === 'user' || message.role === 'system');
    const tail = context.inference.measure({
      ...prepared,
      messages: [...prefix, ...retained, ...history.slice(cuts[middle]!)],
    });
    if (!tail) return null;
    const fixed = context.inference.measure({ ...prepared, messages: [...prefix, ...retained] });
    if (!fixed) return null;
    const tailTokens = Math.max(0, tail.estimatedInputTokens - fixed.estimatedInputTokens);
    if (tailTokens >= protectedTokens) { lastKept = middle; low = middle + 1; }
    else high = middle - 1;
  }
  // 在完整交互边界二分寻找可容纳的最大分段，避免折半时跳过较大的可用段。
  low = 0;
  high = lastKept;
  let selected: { request: InferEffect; coveredMessageCount: number } | null = null;
  while (low <= high) {
    const index = Math.floor((low + high) / 2);
    const coveredMessageCount = cuts[index]!;
    // 推理模型的思考 token 与正文共享输出预算；上限过小时思考会写满预算，
    // 摘要因正文为空且 stopReason=length 被拒绝。0 表示按模型窗口自动取值（给思考留足余量）。
    const requestedBudget = options.summaryBudgetTokens && options.summaryBudgetTokens > 0
      ? options.summaryBudgetTokens
      : 32_768;
    const config = { ...effect.config };
    // 摘要请求不携带 Profile；未显式指定摘要推理等级时优先选用模型支持的最低思考档，避免思考耗尽输出预算。
    delete config.contextProfile;
    delete config.reasoning;
    config.maxTokens = Math.min(requestedBudget, measurement.maxOutputTokens, Math.max(1, Math.floor(measurement.contextWindow * 0.1)));
    if (options.reasoning) config.reasoning = options.reasoning;
    else if (measurement.lowestReasoning) config.reasoning = measurement.lowestReasoning;
    const request: InferEffect = {
      type: 'INFER', target: effect.target, promptPrefixCount: 1,
      config,
      messages: [
        { role: 'system', content: COMPACTION_INSTRUCTIONS },
        {
          role: 'user',
          // 摘要仍通过视觉端口读取原图片；JSON 中只留类型描述，不能让模型把编码当正文。
          content: canonicalJson(JSON.parse(JSON.stringify({
            previousSummary: previous?.summary,
            sourceStart: start,
            messages: history.slice(start, coveredMessageCount).map(message => ({
              ...message,
              images: message.images?.map(image => ({ type: image.type, mediaType: image.mediaType })),
            })),
          }))),
          images: history.slice(start, coveredMessageCount).flatMap(message => message.images ?? []),
        },
      ],
    };
    const window = measureWindow(request, context.inference);
    if (!window) return null;
    if (window.estimatedInputTokens <= window.inputLimit) {
      selected = { request, coveredMessageCount };
      low = index + 1;
    } else high = index - 1;
  }
  return selected;
}

export function validateCompaction(result: InferResult, source: readonly Message[]): void {
  if (!result.content.trim() || result.content.length > 16_384 || result.stopReason === 'length' || result.stopReason === 'toolUse' || result.toolCalls?.length) {
    throw new OperationRejected('摘要为空、被截断、超过大小限制或包含工具计划，未采用该摘要。', 'CONTEXT_COMPACTION_INVALID');
  }
  try { validateContextHandoff(result.content, source); } catch (error) {
    if (error instanceof ContextHandoffUnavailable) throw new OperationRejected(error.message, 'CONTEXT_COMPACTION_UNAVAILABLE');
    throw new OperationRejected('Invalid structured handoff or evidence.', 'CONTEXT_COMPACTION_INVALID');
  }
}
