/**
 * INFER Prompt 前缀：Turn 内固定，长度由已提交的显式计数决定。
 */

import { describe, expect, it } from 'vitest';
import type { Effect, Message } from '@archer/contracts';
import { inferPrefixFor, type SessionEffect } from '@archer/agent';

const system: Message = { role: 'system', content: 'trusted rules' };
const reference: Message = { role: 'user', content: 'Project reference data' };
const task: Message = { role: 'user', content: 'Inspect the notes.' };

function sessionEffect(
  effectId: string,
  effect: Effect,
  status: SessionEffect['status'] = 'completed',
): SessionEffect {
  return {
    effectId,
    effect,
    idempotencyKey: `${effectId}:infer`,
    inferenceStep: 1,
    status,
    attempt: 1,
    createdAt: 1,
  };
}

function infer(messages: Message[], promptPrefixCount: number): SessionEffect {
  return sessionEffect('turn:e1', {
    type: 'INFER', target: { providerId: 'inference', capabilityId: 'model', contractId: 'archer.inference@1', revision: 'test' },
    messages,
    promptPrefixCount,
  });
}

describe('inferPrefixFor', () => {
  it('按第一个 INFER 的计数截取前缀', () => {
    const prefix = inferPrefixFor({ effects: [infer([system, reference, task], 2)] });
    expect(prefix).toEqual([system, reference]);
  });

  it('计数为零时不把任务消息误当成前缀', () => {
    const prefix = inferPrefixFor({ effects: [infer([system, task], 0)] });
    expect(prefix).toEqual([]);
  });

  it('计数为一或没有 INFER 时返回对应的稳定结果', () => {
    expect(inferPrefixFor({ effects: [infer([system, task], 1)] })).toEqual([system]);
    expect(inferPrefixFor({ effects: [sessionEffect('turn:e1', { type: 'CALL', target: { providerId: 'test', capabilityId: 'operation', contractId: 'archer.tool@1', revision: 'test-source' }, input: {} })] }))
      .toEqual([]);
  });

  it('只读取第一个 INFER，不受后续推理快照影响', () => {
    const later = sessionEffect('turn:e2', {
      type: 'INFER', target: { providerId: 'inference', capabilityId: 'model', contractId: 'archer.inference@1', revision: 'test' },
      messages: [{ role: 'system', content: 'changed' }, task],
      promptPrefixCount: 1,
    });
    const prefix = inferPrefixFor({ effects: [infer([system, reference, task], 2), later] });
    expect(prefix).toEqual([system, reference]);
  });
});
