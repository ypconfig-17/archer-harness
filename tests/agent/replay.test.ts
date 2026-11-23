/** 会话事实只折叠一次；线上决策与日志恢复共享同一组安全校验。 */
import { describe, expect, it } from 'vitest';
import type { AgentDraft, Message, TurnFact } from '@archer/contracts';
import { DraftBuilder, inferPrefixFor, replayAgent } from '@archer/agent';
import { MemoryAgentJournal } from '@archer/storage';

const turnId = 'agent:t1';
const effectId = `${turnId}:e1`;
const turn = (event: TurnFact): AgentDraft => ({ scope: 'turn', turnId, event });
const initial: AgentDraft[] = [
  { scope: 'agent', event: { type: 'agent.created', data: { id: 'agent', policyId: 'function-call', instructions: 'Answer.', inference: {}, capabilityFormat: 'provider', createKey: 'key', createdAt: 1 } } },
  turn({ type: 'turn.created', data: { turnId, inputId: 'agent:i1', allowShell: false, createdAt: 2 } }),
  turn({ type: 'effect.created', data: { effectId, effect: { type: 'CALL', target: { providerId: 'test', capabilityId: 'operation', contractId: 'archer.tool@1', revision: 'test-source' }, input: 'value' }, idempotencyKey: effectId, createdAt: 3 } }),
];
const started = turn({ type: 'effect.started', data: { effectId, effectType: 'CALL', attempt: 1, startedAt: 4 } });
const unknown = turn({ type: 'effect.unknown', data: { effectId, lastKnownStatus: 'started', detectedAt: 5, error: { code: 'UNKNOWN_SIDE_EFFECT', message: 'Connection lost after write.' } } });

async function recorded(drafts: AgentDraft[]) {
  return new MemoryAgentJournal().append({ agentId: 'agent', expectedSeq: 0, drafts });
}

describe('Agent 唯一事实折叠', () => {
  it('回放不注入默认轮数上限，并保留显式预算', async () => {
    for (const limits of [undefined, { maxInferenceSteps: 3 }]) {
      const drafts = [initial[0]!, turn({ type: 'turn.created', data: {
        turnId, inputId: 'agent:i1', allowShell: false, createdAt: 2,
        ...(limits ? { limits } : {}),
      } })];
      const restored = replayAgent('agent', await recorded(drafts));
      expect(restored!.turns.get(turnId)!.limits.maxInferenceSteps).toBe(limits?.maxInferenceSteps);
    }
  });

  it('即时折叠与日志恢复产生相同会话和待对账记录', async () => {
    const drafts = [...initial, started, unknown];
    const builder = new DraftBuilder(null);
    for (const draft of drafts) builder.add(draft);
    const restored = replayAgent('agent', await recorded(drafts));
    expect(restored).toEqual(builder.state);
    expect(restored!.turns.get(turnId)?.pending).toMatchObject({ kind: 'reconcile', effectId, error: { code: 'UNKNOWN_SIDE_EFFECT' } });
  });

  it('未知写入不能通过取消事实或新建意图被绕过', async () => {
    const cancelled = turn({ type: 'effect.cancelled', data: { effectId, reason: 'aborted', finishedAt: 6 } });
    const unknownEvents = await recorded([...initial, started, unknown, cancelled]);
    expect(() => replayAgent('agent', unknownEvents)).toThrow('操作不能被确认取消');
    const second = turn({ type: 'effect.created', data: { effectId: `${turnId}:e2`, effect: { type: 'CALL', target: { providerId: 'test', capabilityId: 'operation', contractId: 'archer.tool@1', revision: 'test-source' }, input: {} }, idempotencyKey: 'second', createdAt: 6 } });
    const overlapping = await recorded([...initial, started, unknown, second]);
    expect(() => replayAgent('agent', overlapping)).toThrow('未收束');
    const ended = await recorded([...initial, started, unknown, turn({ type: 'turn.failed', data: { error: { code: 'INTERNAL', message: 'skip unknown' }, completedAt: 6 } })]);
    expect(() => replayAgent('agent', ended)).toThrow('未解决');
  });

  it('错误 attempt、结果类型以及取消后的执行许可均被拒绝', async () => {
    const wrongAttempt = turn({ type: 'effect.started', data: { effectId, effectType: 'CALL', attempt: 2, startedAt: 4 } });
    const wrongResult = turn({ type: 'effect.completed', data: { effectId, effectType: 'CALL', result: { content: 'not a mutation result' }, durationMs: 1, finishedAt: 5 } } as unknown as TurnFact);
    const cancelled = turn({ type: 'turn.cancel.requested', data: { reason: 'stop', requestedAt: 4 } });
    for (const drafts of [[...initial, wrongAttempt], [...initial, started, wrongResult], [...initial, cancelled, started]]) {
      const events = await recorded(drafts);
      expect(() => replayAgent('agent', events)).toThrow();
    }
  });

  it('创建事实必须显式保存策略身份', () => {
    const missing = structuredClone(initial[0]!);
    if (missing.scope === 'agent' && missing.event.type === 'agent.created') Reflect.deleteProperty(missing.event.data, 'policyId');
    expect(() => new DraftBuilder(null).add(missing)).toThrow('策略身份');
  });

  it('INFER Prompt 前缀按显式计数恢复，缺失或越界事实明确拒绝', async () => {
    const messages: Message[] = [
      { role: 'system', content: 'trusted rules' },
      { role: 'user', content: 'Project reference data' },
      { role: 'user', content: 'task' },
    ];
    const inferDrafts = (promptPrefixCount: number): AgentDraft[] => [
      initial[0]!,
      turn({ type: 'turn.created', data: { turnId, inputId: 'agent:i1', allowShell: false, createdAt: 2 } }),
      turn({
        type: 'effect.created',
        data: {
          effectId,
          effect: {
            type: 'INFER', target: { providerId: 'inference', capabilityId: 'model', contractId: 'archer.inference@1', revision: 'test' },
            messages,
            promptPrefixCount,
          },
          idempotencyKey: effectId,
          createdAt: 3,
        },
      }),
    ];

    const empty = replayAgent('agent', await recorded(inferDrafts(0)));
    expect(inferPrefixFor(empty!.turns.get(turnId)!)).toEqual([]);
    for (const count of [undefined, -1, 4]) {
      const invalid = inferDrafts(count as number);
      await expect(recorded(invalid).then(events => replayAgent('agent', events))).rejects.toThrow();
    }

    const current = replayAgent('agent', await recorded(inferDrafts(2)));
    expect(current).not.toBeNull();
    expect(inferPrefixFor(current!.turns.get(turnId)!)).toEqual(messages.slice(0, 2));
  });
});
