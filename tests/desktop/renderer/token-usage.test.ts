/** 用量来自已提交结果；缓存是输入子集，未知明细不能伪造为零。 */
import { expect, it } from 'vitest';
import type { AgentEvent, Snapshot, TokenUsage } from '@archer/contracts';
import { buildItems } from '../../../apps/desktop/renderer/src/lib/conversation.js';
import { turnPresentations } from '../../../apps/desktop/renderer/src/lib/transcript.js';

function events(usages: (TokenUsage | undefined)[]): Snapshot<AgentEvent>[] {
  return usages.flatMap((usage, index) => {
    const effectId = `e${index}`;
    const request = { type: 'INFER', target: { providerId: 'p', capabilityId: 'c', contractId: 'archer.inference@1', revision: 'r' }, messages: [], promptPrefixCount: 0 };
    return [
      { type: 'effect.created', data: { effectId, createdAt: 0, effect: request } },
      { type: 'inference.requested', data: { effectId, requestId: `r${index}`, purpose: 'agent', request, requestedAt: 0 } },
      { type: 'inference.responded', data: { effectId, requestId: `r${index}`, result: { content: 'ok', ...(usage ? { usage } : {}) }, respondedAt: 0 } },
      { type: 'effect.completed', data: { effectId, effectType: 'INFER', result: { content: 'ok', ...(usage ? { usage } : {}) } } },
    ].map((event, offset) => ({ id: `a:${index * 4 + offset}`, agentId: 'a', seq: index * 4 + offset, ts: 0,
      fact: { scope: 'turn', turnId: 'a:t1', turnSeq: index * 4 + offset, event } }) as Snapshot<AgentEvent>);
  });
}
it('按推理逐次累加输入输出与缓存，最近一次输入独立展示且重新投影不会重复累计', () => {
  const items = buildItems(events([
    { promptTokens: 100, completionTokens: 10, cacheReadTokens: 80, cacheWriteTokens: 0 },
    { promptTokens: 200, completionTokens: 20, cacheReadTokens: 150, cacheWriteTokens: 10 },
  ]));
  const turns = turnPresentations(items);
  expect(turns.get('a:t1')).toMatchObject({ inferenceSteps: 2, latestInputTokens: 200,
    usage: { promptTokens: 300, completionTokens: 30, cacheReadTokens: 230, cacheWriteTokens: 10 } });
  expect(turnPresentations(items)).toEqual(turns);
});
it.each([undefined, { promptTokens: 100, completionTokens: 10 }])('任一推理缺少缓存明细时累计缓存保持未知', usage => {
  const turns = turnPresentations(buildItems(events([usage, { promptTokens: 100, completionTokens: 10, cacheReadTokens: 80, cacheWriteTokens: 0 }])));
  expect(turns.get('a:t1')!.usage.cacheReadTokens).toBeUndefined();
  expect(turns.get('a:t1')!.usage.cacheWriteTokens).toBeUndefined();
  expect(turns.get('a:t1')!.usageIncomplete).toBe(usage === undefined);
});

it('摘要和普通请求都累计，外层完成结果不重复计数', () => {
  const source = events([{ promptTokens: 10, completionTokens: 5 }, { promptTokens: 20, completionTokens: 5 }]);
  const summary = source.find(event => event.fact.event.type === 'inference.requested')!;
  if (summary.fact.event.type === 'inference.requested') Reflect.set(summary.fact.event.data, 'purpose', 'compaction');
  expect(turnPresentations(buildItems(source)).get('a:t1')).toMatchObject({ usage: { promptTokens: 30, completionTokens: 10 }, latestInputTokens: 20 });
});
