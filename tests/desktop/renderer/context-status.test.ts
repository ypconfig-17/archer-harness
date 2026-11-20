/** 等待展示只能来自已提交事实，响应、采用、恢复与停止必须区分。 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { InferEffect } from '@archer/contracts';
import { buildItems, type TimelineEvent, type EffectEntry } from '../../../apps/desktop/renderer/src/lib/conversation';
import { contextStatus } from '../../../apps/desktop/renderer/src/lib/context-status';
import { EventTimeline } from '../../../apps/desktop/renderer/src/ui/workspace/EventTimeline';
import { ContextCompactionStatus } from '../../../apps/desktop/renderer/src/ui/workspace/ContextCompaction';

const request: InferEffect = {
  type: 'INFER', promptPrefixCount: 0, messages: [],
  target: { providerId: 'model', capabilityId: 'infer', contractId: 'archer.inference@1', revision: 'v1' },
};
function fact(seq: number, type: string, data: unknown): TimelineEvent {
  return { id: `a:${seq}`, agentId: 'a', seq, ts: seq, fact: { scope: 'turn', turnId: 't', turnSeq: seq, event: { type, data } } } as TimelineEvent;
}
const initial = [
  fact(1, 'effect.created', { effectId: 'e', effect: request, createdAt: 1 }),
  fact(2, 'effect.started', { effectId: 'e', effectType: 'INFER', attempt: 1, startedAt: 2 }),
  fact(3, 'inference.requested', { effectId: 'e', requestId: 'summary', purpose: 'compaction', request, requestedAt: 3 }),
];
const response = fact(4, 'inference.responded', { effectId: 'e', requestId: 'summary', result: { content: 'private-summary-text' }, respondedAt: 4 });
const adopted = fact(5, 'context.compacted', { effectId: 'e', requestId: 'summary', coveredMessageCount: 2, summary: 'private-summary-text', compactedAt: 5 });
const ordinary = fact(6, 'inference.requested', { effectId: 'e', requestId: 'ordinary', purpose: 'agent', request, requestedAt: 6 });
function entry(events = initial): EffectEntry {
  const item = buildItems(events).find(item => item.kind === 'effect');
  if (item?.kind !== 'effect') throw new Error('Missing effect');
  return item.entry;
}

it('请求、响应和采用分别展示压缩、核验和继续，完整回放恢复相同状态', () => {
  expect(contextStatus(entry())?.label).toBe('正在压缩上下文…');
  expect(contextStatus(entry([...initial, response]))?.label).toBe('正在核验上下文摘要…');
  expect(contextStatus(entry([...initial, response, adopted]))?.label).toBe('上下文已整理，正在继续任务…');
  const events = [...initial, response, adopted, ordinary];
  expect(contextStatus(entry(JSON.parse(JSON.stringify(events))))).toEqual(contextStatus(entry(events)));
  expect(contextStatus(entry(events))?.waiting).toBe(false);
});

it('响应没有采用事实时不能展示整理成功；后续普通请求沿用原文', () => {
  expect(contextStatus(entry([...initial, response, ordinary]))?.label).toBe('正在使用原始上下文继续任务…');
  const failed = fact(4, 'inference.request.failed', { effectId: 'e', requestId: 'summary', error: { code: 'PROVIDER_ERROR', message: 'Failed.' }, failedAt: 4 });
  expect(contextStatus(entry([...initial, failed]))).toMatchObject({ label: '上下文压缩请求失败', waiting: false });
});

it('恢复后的新 attempt 不沿用旧请求的等待状态，终态也不继续转圈', () => {
  const restart = fact(4, 'effect.started', { effectId: 'e', effectType: 'INFER', attempt: 2, startedAt: 4 });
  expect(contextStatus(entry([...initial, restart]))).toBeUndefined();
  for (const type of ['effect.cancelled', 'effect.failed', 'effect.unknown']) {
    expect(contextStatus(entry([...initial, fact(4, type, { effectId: 'e' })]))).toBeUndefined();
  }
});

it('等待提示隐藏摘要正文和虚构进度，停止与暂停覆盖加载状态', () => {
  const current = entry([...initial, response]);
  const render = (props = {}) => renderToStaticMarkup(createElement(ContextCompactionStatus, { entry: current, ...props }));
  expect(render()).toContain('正在核验上下文摘要');
  expect(render()).toContain('execution-pulse');
  expect(render()).not.toContain('private-summary-text');
  expect(render()).not.toContain('progressbar');
  expect(render({ cancelling: true })).toContain('正在等待停止确认');
  expect(render({ cancelling: true })).not.toContain('execution-pulse');
  expect(render({ paused: true })).toContain('执行已暂停');
  expect(render({ paused: true })).not.toContain('execution-pulse');
});

it('对话区域只显示一处压缩状态，任务结束后撤下提示且不保留整理记录', () => {
  const start = fact(0, 'turn.created', { turnId: 't', createdAt: 0, allowShell: false });
  const events = [start, ...initial];
  const waiting = renderToStaticMarkup(createElement(EventTimeline, { events, active: true }));
  expect(waiting.match(/正在压缩上下文/g)).toHaveLength(1);
  expect(waiting).not.toContain('正在分析请求');
  const cancelling = renderToStaticMarkup(createElement(EventTimeline, { events, active: true, cancellingTurnId: 't' }));
  expect(cancelling).toContain('正在等待停止确认');
  expect(cancelling).not.toContain('execution-pulse');
  const completed = [...events, response, adopted, ordinary,
    fact(7, 'effect.completed', { effectId: 'e', effectType: 'INFER', result: { content: 'Done.' }, durationMs: 7, finishedAt: 7 }),
    fact(8, 'turn.completed', { summary: 'Done.', completedAt: 8 }),
  ];
  const finished = renderToStaticMarkup(createElement(EventTimeline, { events: completed, active: false }));
  expect(finished).not.toContain('上下文整理');
  expect(finished).not.toContain('正在压缩上下文');
  expect(finished).not.toContain('execution-pulse');
  expect(finished).not.toContain('private-summary-text');
  expect(finished).toContain('执行详情');
  expect(finished).toContain('class="archer-interaction-record"');
});

it('多次推理只在当前阶段显示一处状态，结束后不生成整理入口', () => {
  const completed = [...initial, response, adopted, ordinary,
    fact(7, 'effect.completed', { effectId: 'e', effectType: 'INFER', result: { content: '第一轮过程' }, finishedAt: 7 }),
  ];
  const next = [
    fact(8, 'effect.created', { effectId: 'next', effect: request, createdAt: 8 }),
    fact(9, 'effect.started', { effectId: 'next', effectType: 'INFER', attempt: 1, startedAt: 9 }),
    fact(10, 'inference.requested', { effectId: 'next', requestId: 'next-summary', purpose: 'compaction', request, requestedAt: 10 }),
  ];
  const events = [fact(0, 'turn.created', { createdAt: 0, allowShell: false }), ...completed, ...next];
  const markup = renderToStaticMarkup(createElement(EventTimeline, { events, active: true }));
  expect(markup.match(/正在压缩上下文/g)).toHaveLength(1);
  expect(markup).not.toContain('archer-interaction-record');
  expect(markup).not.toContain('上下文整理');
  expect(markup).toContain('第一轮过程');
  expect(markup).not.toContain('任务进行中');
  expect(markup.indexOf('context-compaction-status')).toBeGreaterThan(markup.indexOf('第一轮过程'));

  const settled = [...events,
    fact(11, 'effect.completed', { effectId: 'next', effectType: 'INFER', result: { content: 'Done.' }, finishedAt: 11 }),
    fact(12, 'turn.completed', { summary: 'Done.', completedAt: 12 }),
  ];
  const finished = renderToStaticMarkup(createElement(EventTimeline, { events: settled, active: false }));
  expect(finished).not.toContain('上下文整理');
  expect(finished).not.toContain('正在压缩上下文');
  expect(finished.match(/class="archer-interaction-record"/g)).toHaveLength(1);
});

it('压缩失败保留明确错误；中断、停止和暂停不显示持续压缩动画', () => {
  const failed = fact(4, 'inference.request.failed', {
    effectId: 'e', requestId: 'summary', error: { code: 'PROVIDER_ERROR', message: 'Failed.' }, failedAt: 4,
  });
  const markup = renderToStaticMarkup(createElement(ContextCompactionStatus, { entry: entry([...initial, failed]) }));
  expect(markup).toContain('is-error');
  expect(markup).toContain('上下文压缩请求失败');
  expect(markup).not.toContain('execution-pulse');
  const interrupted = renderToStaticMarkup(createElement(EventTimeline, {
    events: [fact(0, 'turn.created', { createdAt: 0, allowShell: false }), ...initial],
    active: true,
    progress: { e: { agentId: 'a', turnId: 't', effectId: 'e', content: '', phase: 'interrupted' } },
  }));
  expect(interrupted).toContain('推理已中断，等待确认');
  expect(interrupted).not.toContain('execution-pulse');
});
