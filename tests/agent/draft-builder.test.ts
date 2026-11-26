/** DraftBuilder 结构共享与写时隔离：历史 Turn 复用引用，变更 Turn 与顶层容器不污染原状态。 */
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@archer/contracts';
import { DraftBuilder, replayAgent } from '@archer/agent';

function seedState() {
  const events: AgentEvent[] = [
    {
      id: 'a:1',
      agentId: 'a',
      seq: 1,
      ts: 1,
      fact: {
        scope: 'agent',
        event: {
          type: 'agent.created',
          data: {
            id: 'a',
            instructions: 'sys',
            inference: {},
            capabilityFormat: 'provider',
            createKey: 'k1',
            createdAt: 1,
            policyId: 'function-call',
          },
        },
      },
    },
    {
      id: 'a:2',
      agentId: 'a',
      seq: 2,
      ts: 2,
      fact: {
        scope: 'agent',
        event: {
          type: 'input.accepted',
          data: {
            inputId: 'a:i1',
            requestId: 'r1',
            command: 'prompt',
            input: { text: 'hi' },
            allowShell: false,
            commandMode: 'ask',
            receivedAt: 2,
          },
        },
      },
    },
    {
      id: 'a:3',
      agentId: 'a',
      seq: 3,
      ts: 3,
      fact: { scope: 'agent', event: { type: 'input.consumed', data: { inputId: 'a:i1', turnId: 'a:t1' } } },
    },
    {
      id: 'a:4',
      agentId: 'a',
      seq: 4,
      ts: 4,
      fact: {
        scope: 'turn',
        turnId: 'a:t1',
        turnSeq: 1,
        event: { type: 'turn.created', data: { turnId: 'a:t1', inputId: 'a:i1', allowShell: false, commandMode: 'ask', createdAt: 4 } },
      },
    },
    {
      id: 'a:5',
      agentId: 'a',
      seq: 5,
      ts: 5,
      fact: {
        scope: 'turn',
        turnId: 'a:t1',
        turnSeq: 2,
        event: { type: 'turn.completed', data: { stopReason: 'respond', summary: 'ok', completedAt: 5 } },
      },
    },
    {
      id: 'a:6',
      agentId: 'a',
      seq: 6,
      ts: 6,
      fact: {
        scope: 'agent',
        event: {
          type: 'input.accepted',
          data: {
            inputId: 'a:i2',
            requestId: 'r2',
            command: 'prompt',
            input: { text: 'next' },
            allowShell: false,
            commandMode: 'ask',
            receivedAt: 6,
          },
        },
      },
    },
    {
      id: 'a:7',
      agentId: 'a',
      seq: 7,
      ts: 7,
      fact: { scope: 'agent', event: { type: 'input.consumed', data: { inputId: 'a:i2', turnId: 'a:t2' } } },
    },
    {
      id: 'a:8',
      agentId: 'a',
      seq: 8,
      ts: 8,
      fact: {
        scope: 'turn',
        turnId: 'a:t2',
        turnSeq: 1,
        event: { type: 'turn.created', data: { turnId: 'a:t2', inputId: 'a:i2', allowShell: false, commandMode: 'ask', createdAt: 8 } },
      },
    },
  ];
  return replayAgent('a', events)!;
}

describe('DraftBuilder 结构共享', () => {
  it('修改当前 Turn 时隔离原状态且复用未变更的历史 Turn 引用', () => {
    const base = seedState();
    const prevTurn1 = base.turns.get('a:t1')!;
    const prevTurn2 = base.turns.get('a:t2')!;

    const builder = new DraftBuilder(base);
    builder.turn('a:t2', { type: 'message.appended', data: { message: { role: 'user', content: 'next' } } });
    builder.turn('a:t2', { type: 'turn.completed', data: { stopReason: 'respond', summary: 'done', completedAt: 9 } });
    const decision = builder.finish();

    // 未触及的历史 Turn 直接共享引用；被修改的 Turn 写时拷贝，不污染原状态。
    expect(decision.state.turns.get('a:t1')).toBe(prevTurn1);
    expect(decision.state.turns.get('a:t2')).not.toBe(prevTurn2);
    expect(prevTurn2.status).toBe('running');
    expect(decision.state.turns.get('a:t2')?.status).toBe('completed');
    expect(base.messages).toHaveLength(0);
    expect(decision.state.messages).toHaveLength(1);
    expect(base.activeTurnId).toBe('a:t2');
    expect(decision.state.activeTurnId).toBeNull();
  });

  it('消费 queued 输入时更新 requests.turnId 不污染原状态的请求记录', () => {
    const base = seedState();
    const builder = new DraftBuilder(base);
    builder.agent({
      type: 'input.accepted',
      data: {
        inputId: 'a:i3',
        requestId: 'r3',
        command: 'followUp',
        input: { text: 'queued' },
        allowShell: false,
        commandMode: 'ask',
        receivedAt: 10,
      },
    });
    const accepted = builder.finish().state;
    const beforeReq = accepted.requests.get('r3')!;
    expect(beforeReq.turnId).toBeUndefined();

    const b2 = new DraftBuilder(accepted);
    b2.agent({ type: 'input.consumed', data: { inputId: 'a:i3', turnId: 'a:t3' } });
    const consumed = b2.finish().state;

    expect(beforeReq.turnId).toBeUndefined();
    expect(consumed.requests.get('r3')?.turnId).toBe('a:t3');
    expect(accepted.queue).toHaveLength(1);
    expect(consumed.queue).toHaveLength(0);
  });
});
