import type { IconName } from '@archer/ui';
import { capabilityLabel } from './capability';
import type { ContextRequest } from './context-requests';

type RequestMessage = ContextRequest['effect']['messages'][number];
type RequestTool = NonNullable<ContextRequest['effect']['tools']>[number];

export const ROLES = {
  system: '系统指令',
  user: '用户消息',
  assistant: '模型回复',
  tool: '工具结果',
} as const;

export type ContextSelection =
  | { kind: 'message'; index: number }
  | { kind: 'tool'; index: number }
  | { kind: 'preparations' }
  | { kind: 'declarations' }
  | { kind: 'projection' };

export type EntryCategory = 'messages' | 'tools' | 'references';

export interface ContextEntry {
  key: string;
  title: string;
  description: string;
  meta?: string;
  icon: IconName;
  selection: ContextSelection;
  searchText: string;
}

export interface ContextEntryGroup {
  key: string;
  title: string;
  icon: IconName;
  unit: '条' | '项';
  category: EntryCategory;
  entries: ContextEntry[];
}

/** 角色只决定阅读分组与图标，不改变消息在请求中的顺序或身份。 */
export function roleIcon(role: RequestMessage['role']): IconName {
  const icons: Record<RequestMessage['role'], IconName> = {
    system: 'shield',
    user: 'compose',
    assistant: 'spark',
    tool: 'terminal',
  };
  return icons[role];
}

export function messagePreview(message: RequestMessage): string {
  const text = message.content.replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 96);
  if (message.toolCalls?.length) return message.toolCalls.map(call => call.name).join(', ');
  if (message.images?.length) return `${message.images.length} 张图片`;
  return '无正文';
}

function messageEntry(message: RequestMessage, index: number): ContextEntry {
  return {
    key: `message:${index}`,
    title: `${ROLES[message.role]} · ${index + 1}`,
    description: messagePreview(message),
    meta: message.toolName,
    icon: roleIcon(message.role),
    selection: { kind: 'message', index },
    searchText: `${ROLES[message.role]} ${message.toolName ?? ''} ${message.content}`,
  };
}

function toolEntry(tool: RequestTool, index: number): ContextEntry {
  return {
    key: `tool:${index}`,
    title: capabilityLabel(tool.target),
    description: tool.description,
    meta: `${tool.target.providerId} · ${tool.target.revision}`,
    icon: 'terminal',
    selection: { kind: 'tool', index },
    searchText: `${tool.name} ${tool.description} ${capabilityLabel(tool.target)} ${tool.target.providerId} ${tool.target.contractId} ${tool.target.revision}`,
  };
}

/**
 * 条目按消息角色、工具声明与推理参考分组；工具结果归入「工具」筛选，
 * 参考分组保留准备结果、声明与整理事实三种不同来源，不合并成同一种记录。
 */
export function contextEntryGroups(request: ContextRequest): ContextEntryGroup[] {
  const messages = request.effect.messages.map((message, index) => ({ message, index }));
  const group = (
    role: RequestMessage['role'],
    key: string,
    title: string,
    category: EntryCategory,
  ): ContextEntryGroup => ({
    key,
    title,
    icon: roleIcon(role),
    unit: '条',
    category,
    entries: messages
      .filter(item => item.message.role === role)
      .map(item => messageEntry(item.message, item.index)),
  });
  const tools = request.effect.tools ?? [];
  const references: ContextEntry[] = [];
  if (request.preparations?.length) {
    references.push({
      key: 'preparations',
      title: '推理前参考结果',
      description: `${request.preparations.length} 项已返回参考`,
      icon: 'folder',
      selection: { kind: 'preparations' },
      searchText: JSON.stringify(request.preparations),
    });
  }
  if (request.effect.preparations?.length) {
    references.push({
      key: 'declarations',
      title: '准备能力声明',
      description: `${request.effect.preparations.length} 项已声明参考能力`,
      icon: 'list',
      selection: { kind: 'declarations' },
      searchText: JSON.stringify(request.effect.preparations),
    });
  }
  if (request.effect.contextProjection || request.contextPlan) {
    references.push({
      key: 'projection',
      title: '上下文整理事实',
      description: request.contextPlan ? `${request.contextPlan.steps.length} 个整理步骤` : '消息投影统计',
      icon: 'list',
      selection: { kind: 'projection' },
      searchText: JSON.stringify({
        projection: request.effect.contextProjection,
        contextPlan: request.contextPlan,
      }),
    });
  }
  const all: ContextEntryGroup[] = [
    group('system', 'system', '系统指令', 'messages'),
    group('user', 'user', '用户消息', 'messages'),
    group('assistant', 'assistant', '模型回复', 'messages'),
    group('tool', 'results', '工具结果', 'tools'),
    {
      key: 'declarations',
      title: '工具声明',
      icon: 'terminal',
      unit: '项',
      category: 'tools',
      entries: tools.map(toolEntry),
    },
    {
      key: 'references',
      title: '参考与整理',
      icon: 'folder',
      unit: '项',
      category: 'references',
      entries: references,
    },
  ];
  return all.filter(item => item.entries.length > 0);
}