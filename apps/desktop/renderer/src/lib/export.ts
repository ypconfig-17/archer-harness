import { taskErrorMessage } from './task-error';
/** 会话导出：Markdown 保留执行过程与统计，JSON 保留完整已提交事实。 */
import type { AgentEvent, AgentSnapshot, Snapshot } from '@archer/contracts';
import { client } from './api';
import { buildItems, type EffectEntry } from './conversation';
import { assistantText } from './format';
import { commandResult, durationText, operationState, operationSummary } from './operation';
import { turnPresentations } from './transcript';

function fence(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length));
  const marker = '`'.repeat(Math.max(3, longest + 1));
  return `${marker}\n${text.replace(/\n$/, '')}\n${marker}`;
}

function titleOf(state: Snapshot<AgentSnapshot>): string {
  if (state.title) return state.title;
  const first = state.messages.find(message => message.role === 'user' && !message.content.startsWith('[System observation]'));
  return first?.content.replace(/\s+/g, ' ').trim().slice(0, 70) || '新会话';
}

function entryDuration(entry: EffectEntry): string | undefined {
  const end = entry.end;
  if (!end || !('durationMs' in end.data) || typeof end.data.durationMs !== 'number') return undefined;
  return durationText(end.data.durationMs);
}

function effectMarkdown(entry: EffectEntry, finalEffectId: string | undefined): string {
  if (entry.effectId === finalEffectId) return '';
  const summary = operationSummary(entry);
  const status = operationState(entry);
  const lines = [`#### ${summary.title}${summary.target ? ` \`${summary.target}\`` : ''}`, '', `- 状态：${status.label}${status.detail ? `（${status.detail}）` : ''}`];
  const duration = entryDuration(entry);
  if (duration) lines.push(`- 耗时：${duration}`);
  if (summary.detail) lines.push(`- 详情：${summary.detail}`);

  const end = entry.end;
  if (end?.type === 'effect.completed' && end.data.effectType === 'INFER') {
    const text = assistantText(end.data.result.content);
    if (end.data.result.reasoning) lines.push('', '推理：', '', fence(end.data.result.reasoning));
    if (text) lines.push('', fence(text));
    if (end.data.result.usage) {
      lines.push('', `- tokens：输入 ${end.data.result.usage.promptTokens.toLocaleString()} · 输出 ${end.data.result.usage.completionTokens.toLocaleString()} · 输入中缓存读取 ${end.data.result.usage.cacheReadTokens?.toLocaleString() ?? '未知'} · 缓存写入 ${end.data.result.usage.cacheWriteTokens?.toLocaleString() ?? '未知'}`);
    }
    return lines.join('\n');
  }

  if (end?.type === 'effect.completed' && end.data.effectType === 'ASK_HUMAN') {
    lines.push('', `回答：${end.data.result.approved ? '已同意' : '已拒绝'}${end.data.result.response ? ` · ${end.data.result.response}` : ''}`);
    return lines.join('\n');
  }

  if (entry.effect) {
    const request = entry.effect.type === 'CALL' ? entry.effect.input : entry.effect;
    lines.push('', '请求：', '', fence(JSON.stringify(request, null, 2)));
  }
  if (end?.type === 'effect.completed') {
    const command = commandResult(entry);
    if (command) {
      lines.push('', `工作目录：\`${command.cwd}\` · 退出码 ${command.exitCode}`, '', '标准输出：', '', fence(command.stdout || '（无）'));
      if (command.stderr) lines.push('', '标准错误：', '', fence(command.stderr));
    } else {
      lines.push('', '结果：', '', fence(JSON.stringify(end.data.result, null, 2)));
    }
  } else if (end?.type === 'effect.failed') {
    lines.push('', '错误：', '', fence(`${end.data.error.code}: ${end.data.error.message}`));
  } else if (end?.type === 'effect.unknown') {
    lines.push('', '结果未知：尚未确认外部操作是否生效。');
  } else if (end?.type === 'effect.cancelled') {
    lines.push('', `取消原因：${end.data.reason}`);
  }
  return lines.join('\n');
}

/** 根据完整事件窗口生成可阅读的 Markdown 记录。 */
export function sessionMarkdown(state: Snapshot<AgentSnapshot>, events: readonly Snapshot<AgentEvent>[]): string {
  const items = buildItems(events);
  const turns = turnPresentations(items);
  const lines = [
    `# ${titleOf(state)}`,
    '',
    `- 会话 ID：\`${state.id}\``,
    ...(state.workspace ? [`- 工作区：\`${state.workspace.cwd}\`（${state.workspace.access === 'edit' ? '可编辑' : '只读'}）`] : []),
    `- 创建时间：${new Date(state.createdAt).toLocaleString('zh-CN', { hour12: false })}`,
    `- 导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    `- 任务数：${turns.size}`,
    '',
  ];

  for (const item of items) {
    if (item.kind === 'notice') continue;
    if (item.kind === 'user') {
      lines.push(`**用户${item.label === '发送' ? '' : `（${item.label}）`}**`, '', item.text, '');
      continue;
    }
    if (item.kind === 'turn-start') {
      lines.push(`## 任务 ${item.turnId.split(':t').at(-1)}`, '');
      if (item.note) lines.push(`> ${item.note}`, '');
      continue;
    }
    if (item.kind === 'effect') {
      const turn = turns.get(item.turnId);
      const markdown = effectMarkdown(item.entry, turn?.finalEffectId);
      if (markdown) lines.push(markdown, '');
      continue;
    }
    const turn = turns.get(item.turnId);
    lines.push('### 回复', '');
    if (item.fact.type === 'turn.completed') lines.push(turn?.answer ?? '任务已完成。');
    else if (item.fact.type === 'turn.failed') lines.push(`任务未完成：${taskErrorMessage(item.fact.data.error.message)}`);
    else lines.push(item.fact.data.reason && item.fact.data.reason !== 'aborted' ? `任务已取消：${item.fact.data.reason}` : '任务已停止');
    if (turn) {
      const stats: string[] = [];
      if (turn.startedAt !== undefined && turn.endedAt !== undefined) stats.push(durationText(turn.endedAt - turn.startedAt));
      stats.push(`${turn.operations} 项操作`, `${turn.inferenceSteps} 次推理`);
      if (turn.hasUsage) stats.push(`${(turn.usage.promptTokens + turn.usage.completionTokens).toLocaleString()} tokens（输入 ${turn.usage.promptTokens.toLocaleString()} · 输出 ${turn.usage.completionTokens.toLocaleString()}）`);
      if (turn.models.length) stats.push(turn.models.join(', '));
      lines.push('', `> ${stats.join(' · ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** 原始导出保留状态快照与全部已提交事件，供后续程序处理。 */
export function sessionJson(state: Snapshot<AgentSnapshot>, events: readonly Snapshot<AgentEvent>[]): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), agent: state, events }, null, 2);
}

export function downloadText(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safeFilename(title: string): string {
  return title.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || '会话';
}

async function allEvents(agentId: string): Promise<readonly Snapshot<AgentEvent>[]> {
  const events: Snapshot<AgentEvent>[] = [];
  let cursor = 0;
  while (true) {
    const page = await client.events(agentId, { afterSeq: cursor, limit: 500 });
    if (page.length === 0) return events;
    events.push(...page);
    cursor = page.at(-1)!.seq;
  }
}

/** 读取服务端完整事实后导出；不依赖界面当前加载窗口。 */
export async function exportSession(agentId: string, format: 'markdown' | 'json'): Promise<void> {
  const [state, events] = await Promise.all([
    client.agentState(agentId),
    allEvents(agentId),
  ]);
  if (!state) throw new Error(`Agent 不存在：${agentId}`);
  const name = safeFilename(titleOf(state));
  if (format === 'markdown') downloadText(`${name}.md`, sessionMarkdown(state, events), 'text/markdown;charset=utf-8');
  else downloadText(`${name}.json`, sessionJson(state, events), 'application/json;charset=utf-8');
}
