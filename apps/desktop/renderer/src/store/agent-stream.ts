/**
 * Agent 事件流缓存。
 *
 * HTTP 历史补齐与 SSE 实时推送可能重叠，统一按 Agent seq 去重并排序。
 */

import { create } from 'zustand';
import type { AgentEvent, Snapshot } from '@archer/contracts';

type StoredEvent = Snapshot<AgentEvent>;

interface AgentStreamState {
  eventsByAgent: Record<string, StoredEvent[]>;
  errorsByAgent: Record<string, string | null>;
  setError(agentId: string, error: string | null): void;
  appendEvents(agentId: string, events: readonly StoredEvent[]): void;
  clear(agentId: string): void;
}

function mergeEvents(
  existing: readonly StoredEvent[],
  incoming: readonly StoredEvent[],
): StoredEvent[] {
  // SSE 按序追加是常态，仅复制数组，不为单条增量重建全量 Map 并排序。
  if (!incoming.length) return existing as StoredEvent[];
  const ordered = [...incoming].sort((a, b) => a.seq - b.seq);
  if (!existing.length || ordered[0]!.seq > existing.at(-1)!.seq) {
    const unique = ordered.filter((event, index) => event.seq !== ordered[index + 1]?.seq);
    return [...existing, ...unique];
  }
  // 补历史与重连允许重叠；相同序号仍以后收到的事实为准。
  const bySeq = new Map<number, StoredEvent>();
  for (const event of existing) bySeq.set(event.seq, event);
  for (const event of incoming) bySeq.set(event.seq, event);
  const merged = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  // 重复补齐不发布新引用，避免没有新事实也触发整页投影。
  if (merged.length === existing.length && merged.every((event, index) => event === existing[index])) {
    return existing as StoredEvent[];
  }
  return merged;
}

export const useAgentStreamStore = create<AgentStreamState>((set) => ({
  eventsByAgent: {},
  errorsByAgent: {},
  setError: (agentId, error) => set(state => ({ errorsByAgent: { ...state.errorsByAgent, [agentId]: error } })),
  appendEvents: (agentId, events) =>
    set((state) => {
      const existing = state.eventsByAgent[agentId] ?? [];
      const merged = mergeEvents(existing, events);
      if (merged === existing) return state;
      return { eventsByAgent: { ...state.eventsByAgent, [agentId]: merged } };
    }),
  clear: (agentId) =>
    set((state) => {
      const next = { ...state.eventsByAgent };
      delete next[agentId];
      const errors = { ...state.errorsByAgent };
      delete errors[agentId];
      return { eventsByAgent: next, errorsByAgent: errors };
    }),
}));
