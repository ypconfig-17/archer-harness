/** 任务导航索引：服务端 Turn 元数据与已加载事件合并，按 Agent 序号从新到旧排列。 */
import type { AgentEvent, Snapshot, TurnSnapshot, TurnStatus } from '@archer/contracts';

export interface TurnNavEntry {
  id: string;
  agentSeq: number;
  createdAt: number;
  status: TurnStatus;
}

export function turnNavEntries(
  turns: readonly Snapshot<TurnSnapshot>[],
  events: readonly Snapshot<AgentEvent>[],
): TurnNavEntry[] {
  const entries = new Map<string, TurnNavEntry>();
  for (const turn of turns) {
    entries.set(turn.turnId, {
      id: turn.turnId,
      agentSeq: turn.agentSeq,
      createdAt: turn.createdAt,
      status: turn.status,
    });
  }
  // Turn 创建事实补齐索引可能尚未覆盖的更早 Turn，并携带确定的 Agent 序号。
  for (const event of events) {
    if (event.fact.scope !== 'turn' || event.fact.event.type !== 'turn.created') continue;
    const existing = entries.get(event.fact.event.data.turnId);
    entries.set(event.fact.event.data.turnId, {
      id: event.fact.event.data.turnId,
      agentSeq: event.seq,
      createdAt: event.fact.event.data.createdAt,
      status: existing?.status ?? 'running',
    });
  }
  // 已加载窗口中的终态事实领先于轮询快照，按事实覆盖展示状态。
  for (const event of events) {
    if (event.fact.scope !== 'turn') continue;
    const entry = entries.get(event.fact.turnId);
    if (!entry) continue;
    if (event.fact.event.type === 'turn.completed') entry.status = 'completed';
    else if (event.fact.event.type === 'turn.failed') entry.status = 'failed';
    else if (event.fact.event.type === 'turn.cancelled') entry.status = 'cancelled';
  }
  return [...entries.values()].sort((a, b) => b.agentSeq - a.agentSeq);
}
