/** 展示投影必须保留事实顺序，并正确区分失败、取消与未知结果。 */
import { describe, expect, it } from 'vitest';
import type { AgentEvent, Snapshot } from '@archer/contracts';
import { buildItems } from '../../../apps/desktop/renderer/src/lib/conversation.js';

function turn(seq: number, type: string, data: unknown): Snapshot<AgentEvent> {
  return { id: `a:${seq}`, agentId: 'a', seq, ts: 100, fact: { scope: 'turn', turnId: 'a:t1', turnSeq: seq, event: { type, data } } } as Snapshot<AgentEvent>;
}
function operationEvents(end: string) {
  return [
    turn(1, 'effect.created', { effectId: 'e1', effect: { type: 'CALL', target: { providerId: 'test', capabilityId: 'operation', contractId: 'archer.tool@1', revision: 'test-source' }, input: { content: 'x' } } }),
    turn(2, 'effect.started', { effectId: 'e1', effectType: 'CALL' }),
    turn(3, end, { effectId: 'e1', reason: 'stopped', error: { code: 'IO', message: 'unknown' } }),
  ];
}
describe('对话事件投影', () => {
  it.each(['effect.unknown', 'effect.failed', 'effect.cancelled'])('将 %s 保留在同一张操作卡片中', end => {
    const items = buildItems(operationEvents(end));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'effect', seq: 1, entry: { effectId: 'e1', effectType: 'CALL', end: { type: end } } });
  });
  it('取消请求只显示请求事实，不提前把执行记为已取消', () => {
    const items = buildItems([...operationEvents('effect.unknown').slice(0, 2), turn(3, 'turn.cancel.requested', { reason: 'user' })]);
    expect(items[0]).toMatchObject({ kind: 'effect', entry: { effectId: 'e1' } });
    if (items[0]?.kind === 'effect') expect(items[0].entry.end).toBeUndefined();
    expect(items[1]).toMatchObject({ kind: 'notice', text: '已请求停止任务，等待执行确认' });
  });
});
