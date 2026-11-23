import type { ContextRequest } from './context-requests';

export type CompositionKey = 'conversation' | 'results' | 'declarations' | 'system' | 'references';
type RequestMessage = ContextRequest['effect']['messages'][number];

export interface CompositionSlice {
  key: CompositionKey;
  label: string;
  note: string;
  chars: number;
  share: number;
}

/**
 * 按请求快照逐类统计字符数。日志只记录整次请求的 usage，没有分类 Token；
 * 这里不推断 Token，占比只描述可核对的正文字符体积，避免把估算显示成事实。
 */
export function contextComposition(request: ContextRequest): CompositionSlice[] {
  const messages = request.effect.messages;
  const conversation = messages.filter(message => message.role === 'user' || message.role === 'assistant');
  const results = messages.filter(message => message.role === 'tool');
  const system = messages.filter(message => message.role === 'system');
  const tools = request.effect.tools ?? [];
  const references = [
    ...(request.preparations ?? []),
    ...(request.effect.preparations ?? []),
  ];
  const messageChars = (list: readonly RequestMessage[]): number => list.reduce(
    (sum, message) => sum + message.content.length
      + (message.toolCalls?.length ? JSON.stringify(message.toolCalls).length : 0),
    0,
  );
  const slices: Omit<CompositionSlice, 'share'>[] = [
    {
      key: 'conversation',
      label: '会话消息',
      note: `用户与模型 · ${conversation.length} 条`,
      chars: messageChars(conversation),
    },
    {
      key: 'results',
      label: '工具结果',
      note: `工具执行返回 · ${results.length} 条`,
      chars: messageChars(results),
    },
    {
      key: 'declarations',
      label: '工具声明',
      note: `原生 tools 通道 · ${tools.length} 个`,
      chars: tools.length ? JSON.stringify(tools).length : 0,
    },
    {
      key: 'system',
      label: '系统指令',
      note: `system · ${system.length} 条`,
      chars: messageChars(system),
    },
    {
      key: 'references',
      label: '推理参考',
      note: `补充上下文 · ${references.length} 项`,
      chars: references.length ? JSON.stringify(references).length : 0,
    },
  ];
  const total = slices.reduce((sum, slice) => sum + slice.chars, 0);
  return slices.map(slice => ({
    ...slice,
    share: total ? Math.round((slice.chars / total) * 1000) / 10 : 0,
  }));
}