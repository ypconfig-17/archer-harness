/**
 * 桌面端展示辅助函数。
 */

import { type ContentBlock } from '@archer/contracts';

export type DisplayInput = string | { readonly content: readonly ContentBlock[] };

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

export function formatRelative(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

export function truncate(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Turn id 前缀是 Agent id；展示时只保留 Turn 序号 */
export function shortTurnId(turnId: string): string {
  const separator = turnId.lastIndexOf(':');
  return separator === -1 ? turnId : turnId.slice(separator + 1);
}

/** 提取 assistant 输出中的 message */
export function assistantText(content: string): string {
  return content.trim();
}

/** 把 Agent 输入投影为可展示文本；非文本块用占位符表示 */
export function inputText(input: DisplayInput): string {
  if (typeof input === 'string') return input;
  return input.content
    .map((block) => (block.type === 'text' ? block.text : block.type === 'file' && 'filename' in block ? `[附件：${block.filename}]` : `[${block.type}]`))
    .join('\n');
}
