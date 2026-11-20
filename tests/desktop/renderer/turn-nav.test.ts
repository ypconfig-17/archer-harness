import { expect, it } from 'vitest';
import type { AgentEvent, Snapshot, TurnSnapshot } from '@archer/contracts';
import { turnNavEntries } from '../../../apps/desktop/renderer/src/lib/turn-nav.js';

function turn(
  turnId: string,
  agentSeq: number,
  status: TurnSnapshot['status'],
): Snapshot<TurnSnapshot> {
  return {
    agentId: 'agent-1',
    turnId,
    agentSeq,
    createdAt: 1000 + agentSeq,
    allowShell: false,
    commandMode: 'ask',
    seq: 1,
    status,
    pending: null,
  } as Snapshot<TurnSnapshot>;
}

function created(seq: number, turnId: string, createdAt: number): Snapshot<AgentEvent> {
  return {
    id: `event-${seq}`,
    agentId: 'agent-1',
    seq,
    ts: createdAt,
    fact: {
      scope: 'turn',
      turnId,
      turnSeq: seq,
      event: {
        type: 'turn.created',
        data: { turnId, inputId: `input-${turnId}`, allowShell: false, createdAt },
      },
    },
  } as Snapshot<AgentEvent>;
}

function completed(seq: number, turnId: string): Snapshot<AgentEvent> {
  return {
    id: `event-${seq}`,
    agentId: 'agent-1',
    seq,
    ts: 9000,
    fact: {
      scope: 'turn',
      turnId,
      turnSeq: seq,
      event: { type: 'turn.completed', data: { stopReason: 'done', completedAt: 9000 } },
    },
  } as Snapshot<AgentEvent>;
}

it('服务端索引中的未加载 Turn 按 Agent 序号从新到旧排列', () => {
  const entries = turnNavEntries([turn('older', 10, 'completed'), turn('newer', 30, 'running')], []);
  expect(entries.map(entry => entry.id)).toEqual(['newer', 'older']);
});

it('已加载事件补齐索引之外的 Turn，并以终态事实覆盖状态', () => {
  const entries = turnNavEntries(
    [turn('agent:t2', 40, 'running')],
    [created(10, 'agent:t1', 5000), completed(12, 'agent:t1')],
  );
  expect(entries.map(entry => entry.id)).toEqual(['agent:t2', 'agent:t1']);
  expect(entries[1]).toEqual({ id: 'agent:t1', agentSeq: 10, createdAt: 5000, status: 'completed' });
});
