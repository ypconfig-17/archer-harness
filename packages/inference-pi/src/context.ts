/**
 * Archer Harness — 上下文转换为 pi-ai 词汇
 *
 * system 消息折叠为单一 systemPrompt；assistant 保留文本、工具请求与签名，
 * tool 消息按调用 ID 还原为工具结果。provider 的进程句柄不进入会话。
 */

import type {
  Api,
  AssistantMessage,
  Context as PiContext,
  Message as PiMessage,
  Model,
  Usage as PiUsage,
} from '@earendil-works/pi-ai';
import type { Message } from '@archer/contracts';

/** pi-ai 历史消息要求的零用量 */
function emptyUsage(): PiUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/**
 * 把 Archer 历史转换为 pi-ai Context。
 * @param messages - 系统提示与对话历史，顺序保持。
 * @param model - 本次请求解析出的模型；用于标记 assistant 历史的协议身份。
 * @returns 带单一 systemPrompt 的请求上下文。
 */
export function toPiContext(messages: readonly Message[], model: Model<Api>): PiContext {
  const system: string[] = [];
  const history: PiMessage[] = [];

  for (const message of messages) {
    switch (message.role) {
      case 'system':
        if (message.content.length > 0) system.push(message.content);
        break;
      case 'user':
        // 不支持视觉的模型明确拒绝，避免只发送文字而静默丢失图片。
        if (message.images?.length && !model.input.includes('image')) {
          throw new Error(`模型 ${model.id} 不支持图片输入`);
        }
        history.push({ role: 'user', content: message.images?.length
          ? [{ type: 'text', text: message.content }, ...message.images.map(image => ({
              type: 'image' as const, data: image.data, mimeType: image.mediaType,
            }))]
          : message.content, timestamp: 0 });
        break;
      case 'tool':
        if (!message.toolCallId || !message.toolName) throw new Error('Tool result lacks call identity.');
        history.push({ role: 'toolResult', toolCallId: message.toolCallId, toolName: message.toolName, content: [{ type: 'text', text: message.content }], isError: message.isError ?? false, timestamp: 0 });
        break;
      case 'assistant': {
        // 空回复不携带信息，发送空 assistant 消息反而可能被 provider 拒绝。
        if (message.content.length === 0 && !message.toolCalls?.length) break;
        const replay = message.reasoningReplay;
        const replayable = replay && replay.api === model.api && replay.provider === model.provider && replay.model === model.id;
        const thinking = replayable ? replay.blocks.map(block => {
          if (message.reasoning === undefined || block.end > message.reasoning.length) throw new Error('Reasoning replay references missing text.');
          return { type: 'thinking' as const, thinking: message.reasoning.slice(block.start, block.end), ...(block.signature === undefined ? {} : { thinkingSignature: block.signature }), ...(block.redacted === undefined ? {} : { redacted: block.redacted }) };
        }) : [];
        const assistant: AssistantMessage = {
          role: 'assistant',
          content: [...thinking, ...(message.content ? [{ type: 'text' as const, text: message.content }] : []), ...(message.toolCalls ?? []).map(call => ({ type: 'toolCall' as const, id: call.id, name: call.name, arguments: call.input as Record<string, never>, ...(call.signature ? { thoughtSignature: call.signature } : {}), ...(call.namespace ? { namespace: call.namespace } : {}) }))],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: emptyUsage(),
          stopReason: message.toolCalls?.length ? 'toolUse' : 'stop',
          timestamp: 0,
        };
        history.push(assistant);
        break;
      }
    }
  }

  return {
    ...(system.length === 0 ? {} : { systemPrompt: system.join('\n\n') }),
    messages: history,
  };
}
