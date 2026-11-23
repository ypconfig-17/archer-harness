import { capabilityLabel } from './capability';
/** 能力结果到展示模型的纯投影；未知能力保留通用请求与结果。 */
import type { IconName } from '@archer/ui';
import type { JsonObject } from '@archer/contracts';
import type { EffectEntry } from './conversation';

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function string(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }

export function resultMetadata(entry: EffectEntry): JsonObject {
  const end = entry.end;
  if (end?.type === 'effect.completed' && end.data.effectType === 'CALL') return record(record(end.data.result.value).metadata) as JsonObject;
  return {};
}
export interface CommandView { command: string; cwd: string; stdout: string; stderr: string; exitCode: number }
export function commandResult(entry: EffectEntry): CommandView | null {
  const data = record(resultMetadata(entry).command);
  if (typeof data.command !== 'string' || typeof data.cwd !== 'string' || typeof data.stdout !== 'string' || typeof data.stderr !== 'string' || !Number.isInteger(data.exitCode)) return null;
  return data as unknown as CommandView;
}
export interface FileChangeView { path: string; before?: string | null; after: string; revisionBefore?: string | null }
export function fileChange(entry: EffectEntry): FileChangeView | null {
  const data = record(resultMetadata(entry).fileChange);
  if (typeof data.path !== 'string' || typeof data.after !== 'string' || (data.before !== undefined && data.before !== null && typeof data.before !== 'string')) return null;
  if (data.revisionBefore !== undefined && data.revisionBefore !== null && typeof data.revisionBefore !== 'string') return null;
  return data as unknown as FileChangeView;
}
export function operationState(entry: EffectEntry): { label: string; tone: 'running' | 'ok' | 'error' | 'warning' | 'idle'; detail?: string } {
  const end = entry.end;
  if (entry.abandonedReason) return { label: '已放弃追踪', tone: 'warning', detail: `${entry.abandonedReason} · 原操作结果仍未知` };
  if (end?.type === 'effect.unknown') return { label: '结果未知', tone: 'warning', detail: '尚未确认外部操作是否生效，需要人工对账。' };
  if (end?.type === 'effect.failed') return { label: '执行失败', tone: 'error', detail: end.data.error.message };
  if (end?.type === 'effect.cancelled') return { label: '已取消', tone: 'warning', detail: end.data.reason };
  if (end?.type === 'effect.completed') {
    const command = commandResult(entry);
    if (command && command.exitCode !== 0) return { label: '命令失败', tone: 'error', detail: `退出码 ${command.exitCode}` };
    if (end.data.effectType === 'CALL' && end.data.result.isError) return { label: '操作未成功', tone: 'error' };
    return { label: '已完成', tone: 'ok' };
  }
  if (entry.suspendedReason) return { label: entry.effect?.type === 'CALL' && entry.effect.interaction !== 'human' ? '等待审批' : '等待回答', tone: 'warning', detail: entry.suspendedReason };
  return entry.started ? { label: '进行中', tone: 'running' } : { label: '等待执行', tone: 'idle' };
}
export function operationSummary(entry: EffectEntry): { title: string; target: string; detail?: string } {
  const effect = entry.effect;
  if (!effect) return { title: entry.effectType ?? '操作', target: '' };
  if (effect.type === 'ASK_HUMAN') return { title: '询问', target: effect.reason };
  if (effect.type !== 'CALL') return { title: effect.type, target: '' };
  const payload = record(effect.input);
  const metadata = resultMetadata(entry);
  const command = commandResult(entry);
  if (command) return { title: '执行命令', target: command.command, detail: command.cwd };
  // 命令载荷本身只表明执行意图，不据此宣称成功或推测能力权限。
  if (typeof payload.command === 'string') return { title: '执行命令', target: payload.command, detail: string(payload.cwd) };
  const name = effect.target.capabilityId;
  const path = string(payload.path) ?? capabilityLabel(effect.target);
  if (name === 'read') {
    const read = record(metadata.read);
    return { title: '读取文件', target: path, detail: typeof read.startLine === 'number' && typeof read.endLine === 'number' ? `${read.startLine}–${read.endLine} 行 · 共 ${read.totalLines} 行` : typeof payload.offset === 'number' ? `从第 ${payload.offset} 行读取` : undefined };
  }
  if (name === 'grep' || name === 'glob') {
    const search = record(metadata.search);
    return { title: name === 'grep' ? '搜索内容' : '查找文件', target: string(payload.pattern) ?? path, detail: typeof search.count === 'number' ? `${search.count} 项结果${search.truncated ? ' · 已截断' : ''} · ${path}` : path };
  }
  if (name === 'list') return { title: '浏览目录', target: path };
  if (name === 'write' || name === 'edit') return { title: name === 'write' ? '写入文件' : '编辑文件', target: path };
  return { title: '调用能力', target: capabilityLabel(effect.target) };
}

/** 工具活动分类只用于折叠行摘要，不改变单次调用的事实或状态。 */
export type OperationCategory = 'read' | 'write' | 'command' | 'other';
export function operationCategory(entry: EffectEntry): OperationCategory {
  const title = operationSummary(entry).title;
  if (['读取文件', '搜索内容', '查找文件', '浏览目录'].includes(title)) return 'read';
  if (['写入文件', '编辑文件'].includes(title)) return 'write';
  if (title === '执行命令') return 'command';
  return 'other';
}

export function durationText(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} 秒`;
  return `${Math.floor(ms / 60_000)} 分 ${Math.floor(ms % 60_000 / 1000)} 秒`;
}


/** 文件名优先只用于阅读；目录与完整原目标不改写，搜索表达式和命令不能被当作路径拆分。 */
export function operationDisplay(entry: EffectEntry) {
  const summary = operationSummary(entry);
  const icons = {
    '浏览目录': 'folder', '搜索内容': 'search', '查找文件': 'search',
    '执行命令': 'terminal', '编辑文件': 'pencil', '写入文件': 'pencil',
  } as const;
  const icon: IconName = entry.effectType === 'INFER' ? 'spark'
    : icons[summary.title as keyof typeof icons] ?? 'file';
  if (!['读取文件', '写入文件', '编辑文件', '浏览目录'].includes(summary.title)) {
    return { ...summary, icon, primary: summary.target, directory: undefined };
  }
  const parts = summary.target.split(/[\\/]/);
  const filename = parts.pop();
  return {
    ...summary, icon, primary: filename || summary.target,
    directory: filename && parts.length ? parts.join('/') || '/' : undefined,
  };
}
