/** 事件导航仅按事实身份组织，不把相近时间或工具名当作阶段关联。 */
import { buildItems, type TimelineEvent } from './conversation';
import { describeEvent } from './event-presentation';
import { operationState, operationSummary, record } from './operation';
import { capabilityLabel } from './capability';
import { turnNumber } from './labels';

export type EventFilter = 'all' | 'tools' | 'inference' | 'failure' | 'attention' | 'human' | 'agent';

export function eventNavigation(events: readonly TimelineEvent[], filter: EventFilter = 'all', toolKey = '') {
  const entries = new Map(buildItems(events).flatMap(item => item.kind === 'effect'
    ? [[JSON.stringify([item.turnId, item.entry.effectId]), item.entry] as const] : []));
  const terminal = new Map<string, string>();
  for (const event of events) {
    if (event.fact.scope !== 'turn') continue;
    const type = event.fact.event.type;
    if (type === 'turn.completed' || type === 'turn.failed' || type === 'turn.cancelled') {
      terminal.set(event.fact.turnId, type === 'turn.completed' ? '已完成' : type === 'turn.failed' ? '失败' : '已取消');
    }
  }
  const rows = events.map(event => {
    const view = describeEvent(event);
    const fact = event.fact.event;
    const data = record(fact.data);
    const turnId = event.fact.scope === 'turn' ? event.fact.turnId : undefined;
    const effectId = typeof data.effectId === 'string' ? data.effectId : undefined;
    const entry = turnId && effectId ? entries.get(JSON.stringify([turnId, effectId])) : undefined;
    const effectType = entry?.effect?.type ?? entry?.effectType ?? data.effectType;
    const summary = entry?.effect ? operationSummary(entry) : undefined;
    const state = entry ? operationState(entry).label : undefined;
    const tool = entry?.effect?.type === 'CALL' ? entry.effect.target : undefined;
    const toolLabel = tool
      ? summary?.title && summary.title !== '调用能力'
        ? `${summary.title} · ${tool.providerId}`
        : capabilityLabel(tool)
      : undefined;
    const human = fact.type === 'command.accepted' || fact.type === 'turn.authorization.changed'
      || (fact.type === 'effect.resumed' && fact.data.kind === 'human') || effectType === 'ASK_HUMAN';
    return {
      event, view, turnId, effectId, state,
      title: effectType === 'INFER' ? '模型推理' : summary?.title ?? (effectId ? '操作记录（声明未加载）' : '任务记录'),
      target: summary?.target,
      toolKey: entry?.effect?.type === 'CALL' ? JSON.stringify([entry.effect.target.providerId, entry.effect.target.capabilityId, entry.effect.target.contractId, entry.effect.target.revision]) : undefined,
      toolLabel,
      tools: effectType === 'CALL',
      inference: effectType === 'INFER',
      failure: view.tone === 'error',
      attention: view.tone === 'error' || view.tone === 'warning',
      human,
      agent: event.fact.scope === 'agent',
    };
  });
  type Row = typeof rows[number];
  type Interaction = { id: string; title: string; target?: string; state?: string; rows: Row[] };
  const groups: { id: string; label: string; status?: string; rows: Row[]; interactions: Interaction[] }[] = [];
  for (const row of rows.filter(row => (filter === 'all' || row[filter]) && (!toolKey || row.toolKey === toolKey))) {
    const id = row.turnId ? `turn:${row.turnId}` : 'agent';
    let group = groups.at(-1);
    if (!group || group.id !== id) {
      group = {
        id,
        label: row.turnId ? `任务 ${turnNumber(row.turnId)}` : '会话',
        status: row.turnId ? terminal.get(row.turnId) : undefined,
        rows: [], interactions: [],
      };
      groups.push(group);
    }
    group.rows.push(row);
    // 无关联字段的事实保留在原位置，不归入前一次或后一次操作。
    const interactionId = row.effectId ? `effect:${row.effectId}` : 'unlinked';
    const previous = group.interactions.at(-1);
    if (previous?.id === interactionId) previous.rows.push(row);
    else group.interactions.push({ id: interactionId, title: row.title, target: row.target, state: row.state, rows: [row] });
  }
  return { rows, groups };
}
