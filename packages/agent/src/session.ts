/**
 * Archer Harness — Agent 会话状态与事实折叠入口
 *
 * 一个 Agent 一份状态：身份、执行配置、消息、队列与全部 Turn。
 * 折叠只消费已提交事实，不读取外部状态，也不执行 I/O。
 */

import type { AgentDraft, AgentEvent } from '@archer/contracts';
import { applyLifecycle, corrupt } from './session-fold-agent.js';
import { applyTurn } from './session-fold-turn.js';
import type { SessionState } from './session-state.js';

export * from './session-state.js';

function requireState(state: SessionState | null): SessionState {
  if (!state) corrupt('Agent 日志缺少 agent.created');
  return state;
}

/** 折叠一条草稿；输入状态会被原地更新 */
export function foldAgentDraft(state: SessionState | null, draft: AgentDraft, seq = 0): SessionState {
  const current =
    draft.scope === 'agent'
      ? applyLifecycle(state, draft.event)
      : applyTurn(requireState(state), draft, seq);
  current.seq = Math.max(current.seq, seq);
  return current;
}

/** 从已提交事件重建会话；校验信封连续性与事实顺序 */
export function replayAgent(agentId: string, events: readonly AgentEvent[]): SessionState | null {
  if (events.length === 0) return null;
  let state: SessionState | null = null;
  let expectedSeq = 1;
  const turnSeq = new Map<string, number>();

  for (const event of events) {
    if (event.agentId !== agentId) corrupt('事件 agentId 与日志不一致');
    if (event.seq !== expectedSeq) corrupt('Agent 日志序号不连续');
    if (event.id !== `${agentId}:${event.seq}`) corrupt('Agent 事件 id 与序号不一致');
    expectedSeq += 1;

    if (event.fact.scope === 'turn') {
      const next = (turnSeq.get(event.fact.turnId) ?? 0) + 1;
      if (event.fact.turnSeq !== next) corrupt('Turn 日志序号不连续');
      turnSeq.set(event.fact.turnId, next);
    }

    state = foldAgentDraft(state, event.fact, event.seq);
  }
  return state;
}
