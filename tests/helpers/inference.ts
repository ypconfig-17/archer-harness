/** 测试模型只返回当前请求中实际提供的原生工具调用。 */
import type { InferEffect, InferResult, JsonValue } from '@archer/contracts';

export function toolReply(effect: InferEffect, id: string, input: JsonValue = {}): InferResult {
  const tool = effect.tools?.find(tool => `${tool.target.providerId}.${tool.target.capabilityId}` === id);
  if (!tool) throw new Error(`Tool is not loaded: ${id}`);
  return { content: '', toolCalls: [{ id: `call_${effect.messages.length}_${tool.name}`, name: tool.name, input }] };
}
