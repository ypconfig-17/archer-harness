/** 界面分组保护身份、原始顺序和终态，不从工具结果猜测任务成功。 */
import { expect, it } from 'vitest';
import { eventNavigation } from '../../../apps/desktop/renderer/src/lib/event-navigation';
import type { TimelineEvent } from '../../../apps/desktop/renderer/src/lib/conversation';

function fact(seq: number, turnId: string, type: string, data: unknown): TimelineEvent {
  return {
    id: `a:${seq}`, agentId: 'a', seq, ts: seq,
    fact: { scope: 'turn', turnId, turnSeq: seq, event: { type, data } },
  } as TimelineEvent;
}
function operation(seq: number, turnId: string, effectId: string, providerId = 'files') {
  return fact(seq, turnId, 'effect.created', {
    effectId, createdAt: seq,
    effect: {
      type: 'CALL',
      target: { providerId, capabilityId: 'read', contractId: 'archer.tool@1', revision: 'v1' },
      input: { path: '/src/example.ts' },
    },
  });
}

it('按同任务的明确操作身份组织，保留全部事实、顺序与输入对象', () => {
  const events = [operation(1, 'a:t1', 'e'), fact(2, 'a:t1', 'effect.started', { effectId: 'e', effectType: 'CALL', attempt: 1, startedAt: 2 }), fact(3, 'a:t1', 'turn.completed', { completedAt: 3 })];
  const before = JSON.stringify(events);
  const { groups } = eventNavigation(events);
  expect(groups[0].interactions[0]).toMatchObject({ title: '读取文件', target: '/src/example.ts' });
  expect(groups.flatMap(group => group.interactions.flatMap(item => item.rows.map(row => row.event)))).toEqual(events);
  expect(groups[0].status).toBe('已完成');
  expect(JSON.stringify(events)).toBe(before);
});

it('缺少操作声明时明确范围，不生成读取或编辑阶段', () => {
  const result = eventNavigation([fact(2, 'a:t1', 'effect.started', { effectId: 'missing', effectType: 'CALL', attempt: 1, startedAt: 2 })]);
  expect(result.groups[0].interactions[0].title).toBe('操作记录（声明未加载）');
  expect(result.groups[0].status).toBeUndefined();
});

it('失败筛选保留任务真实终态，不能把恢复后的整轮完成改成失败', () => {
  const events = [operation(1, 'a:t1', 'e'), fact(2, 'a:t1', 'effect.failed', { effectId: 'e', effectType: 'CALL', error: { code: 'TEST', message: '失败' }, finishedAt: 2 }), fact(3, 'a:t1', 'turn.completed', { completedAt: 3 })];
  const result = eventNavigation(events, 'failure');
  expect(result.groups[0].status).toBe('已完成');
  expect(result.groups[0].rows.map(row => row.event.seq)).toEqual([2]);
});

it('同名能力按完整来源区分，不串用其他 Provider 的记录', () => {
  const events = [operation(1, 'a:t1', 'a', 'first'), operation(2, 'a:t1', 'b', 'second')];
  const key = eventNavigation(events).rows[0].toolKey!;
  expect(eventNavigation(events, 'tools', key).groups[0].rows.map(row => row.event.seq)).toEqual([1]);
});

it('人工介入只匹配明确的人类事实，自动对账重试不冒充人工响应', () => {
  const events = [fact(1, 'a:t1', 'effect.resumed', { effectId: 'e', attempt: 1, kind: 'human', resumedAt: 1 }), fact(2, 'a:t1', 'effect.resumed', { effectId: 'e', attempt: 1, kind: 'reconcile_retry', resumedAt: 2 })];
  expect(eventNavigation(events, 'human').groups[0].rows.map(row => row.event.seq)).toEqual([1]);
});

it('命令返回非零退出码仍进入失败筛选，不因 effect.completed 被标成成功', () => {
  const events = [operation(1, 'a:t1', 'e'), fact(2, 'a:t1', 'effect.completed', {
    effectId: 'e', effectType: 'CALL', finishedAt: 2, durationMs: 1,
    result: { value: { metadata: { command: { command: 'test', cwd: '/src', stdout: '', stderr: 'error', exitCode: 1 } } } },
  })];
  const result = eventNavigation(events, 'failure');
  expect(result.groups[0].rows[0].view).toMatchObject({ title: '命令失败', tone: 'error' });
  expect(result.groups[0].status).toBeUndefined();
});

it('未知结果只进入需关注，不作为确定失败', () => {
  const events = [fact(1, 'a:t1', 'effect.unknown', { effectId: 'e', lastKnownStatus: 'started', detectedAt: 1 })];
  expect(eventNavigation(events, 'failure').groups).toEqual([]);
  expect(eventNavigation(events, 'attention').groups[0].rows[0].event).toBe(events[0]);
});
