import { JSDOM } from 'jsdom';
import { readFileSync, readdirSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { InferEffect } from '@archer/contracts';
import { EventTimeline } from '../../../apps/desktop/renderer/src/ui/workspace/EventTimeline';
import type { TimelineEvent } from '../../../apps/desktop/renderer/src/lib/conversation';

it('顶栏按钮尺寸来自基础按钮变体，不用后代选择器影响嵌套菜单', () => {
  const directory = new URL('../../../apps/desktop/renderer/src/ui/', import.meta.url);
  const css = readdirSync(directory, { recursive: true }).filter((file): file is string => typeof file === 'string' && file.endsWith('.css'))
    .map(file => readFileSync(new URL(file, directory), 'utf8')).join('\n');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const sizing = rules.flatMap(([, selectors, declarations]) => {
    if (!/(?:^|;)\s*(?:width|height)\s*:/.test(declarations)) return [];
    return selectors.split(',').map(selector => selector.trim()).filter(selector => selector.startsWith('.header-actions') && selector.includes('button'));
  });
  // 尺寸由 Button 的 size 变体决定，CSS 不再用后代选择器统一图标按钮。
  expect(sizing).toHaveLength(0);
  const source = readFileSync(new URL('workspace/AgentDetail.tsx', directory), 'utf8');
  const header = source.slice(source.indexOf('<div className="header-actions">'), source.indexOf('</header>'));
  expect(header.match(/size="icon"/g)?.length).toBeGreaterThan(0);
  expect(source).not.toContain('icon-button');
});

function completed(knownUsage: boolean): TimelineEvent[] {
  const request: InferEffect = {
    type: 'INFER',
    promptPrefixCount: 0,
    target: { providerId: 'p', capabilityId: 'infer', contractId: 'archer.inference@1', revision: 'v1' },
    messages: [],
    config: { provider: 'private-provider', model: 'compact-model' },
  };
  const result = {
    content: '答复正文',
    ...(knownUsage ? { usage: { promptTokens: 100_000, completionTokens: 10 } } : {}),
  };
  return [
    { type: 'turn.created', data: { createdAt: 0, allowShell: false } },
    { type: 'effect.created', data: { effectId: 'e', effect: request, createdAt: 1 } },
    { type: 'inference.requested', data: { effectId: 'e', requestId: 'r', purpose: 'agent', request, requestedAt: 2 } },
    { type: 'inference.responded', data: { effectId: 'e', requestId: 'r', result, respondedAt: 3 } },
    { type: 'effect.completed', data: { effectId: 'e', effectType: 'INFER', result, finishedAt: 4, durationMs: 3 } },
    { type: 'turn.completed', data: { completedAt: 5, summary: '答复正文' } },
  ].map((event, index) => ({
    id: `a:${index}`,
    agentId: 'a',
    seq: index,
    ts: index,
    fact: { scope: 'turn', turnId: 'a:t1', turnSeq: index, event },
  }) as TimelineEvent);
}

it('答复默认只保留轻量入口，模型与累计用量仍能从关闭的运行详情查看', () => {
  const markup = renderToStaticMarkup(createElement(EventTimeline, { events: completed(true), active: false }));
  const document = new JSDOM(markup).window.document;
  const details = document.querySelector('.archer-interaction-record')!;
  expect(details).not.toBeNull();
  expect(details.querySelector('[data-slot="collapsible-trigger"]')?.getAttribute('aria-expanded')).toBe('false');
  expect(details.querySelector('[data-slot="collapsible-content"]')?.hasAttribute('hidden')).toBe(true);
  expect(details.textContent).toContain('执行详情');
  expect(details.textContent).toContain('100,010');
  expect(details.textContent).toContain('private-provider/compact-model');
  details.remove();
  expect(document.body.textContent).toContain('答复正文');
  expect(document.body.textContent).not.toContain('100,010');
  expect(document.body.textContent).not.toContain('private-provider/compact-model');
});

it('缺失用量在详情中明确标注，不因简化视觉而补成零', () => {
  const markup = renderToStaticMarkup(createElement(EventTimeline, { events: completed(false), active: false }));
  expect(markup).toContain('未返回用量');
  expect(markup).not.toContain('累计用量</dt><dd>0');
});

it('结束状态与可检查结果形成主线，统计和整理留在详情层', () => {
  const html = renderToStaticMarkup(createElement(EventTimeline, { events: completed(true), active: false }));
  expect(html).toContain('class="archer-turn-summary" data-status="completed"');
  expect(html).toContain('已完成');
  const summaryStart = html.indexOf('执行详情');
  expect(html.indexOf('累计用量')).toBeGreaterThan(summaryStart);
  expect(html.indexOf('推理次数')).toBeGreaterThan(summaryStart);
});

function completedWithCall(): TimelineEvent[] {
  const base = completed(true);
  const call = [
    { type: 'effect.created', data: {
      effectId: 'c', createdAt: 2,
      effect: { type: 'CALL', target: { providerId: 'files', capabilityId: 'read', contractId: 'archer.tool@1', revision: 'v1' }, input: { path: '/src/a.ts' } },
    } },
    { type: 'effect.completed', data: { effectId: 'c', effectType: 'CALL', result: { value: { output: 'source' } }, finishedAt: 3 } },
  ].map((event, index) => ({
    id: `a:c${index}`, agentId: 'a', seq: index, ts: index,
    fact: { scope: 'turn', turnId: 'a:t1', turnSeq: index, event },
  }) as TimelineEvent);
  return [...base.slice(0, -1), ...call, base.at(-1)!].map((event, index) => ({ ...event, seq: index }) as TimelineEvent);
}

it('简洁对话提供默认折叠的累计摘要与独立完整活动入口', () => {
  const html = renderToStaticMarkup(createElement(EventTimeline, {
    events: completedWithCall(), active: false, compact: true, onInspectActivity: () => {},
  }));
  expect(html).toContain('答复正文');
  expect(html).toContain('查看全部活动');
  expect(html).toContain('aria-label="本轮执行摘要"');
  expect(html).toContain('data-tone="muted"');
  expect(html).toContain('archer-activity-group');
  expect(html).toContain('data-closed=""');
  expect(html).not.toContain('aria-expanded="true"');
  expect(html).not.toContain('inference-activity-row');
  expect(html).not.toContain('activity-history');
});

it('没有工具调用的问答不生成零调用摘要', () => {
  const html = renderToStaticMarkup(createElement(EventTimeline, {
    events: completed(true), active: false, compact: true, onInspectActivity: () => {},
  }));
  expect(html).toContain('答复正文');
  expect(html).not.toContain('本轮执行摘要');
  expect(html).not.toContain('查看全部活动');
  expect(html).not.toContain('brief-activity');
});

it('结果摘要不使用卡片边界，失败说明只保留左侧语义边框', () => {
  const library = new URL('../../../packages/ui/src/', import.meta.url);
  const styles = readFileSync(new URL('styles.css', library), 'utf8');
  expect(styles).toMatch(/\.archer-turn-summary\s*\{[^}]*margin-block:/);
  expect(styles).not.toMatch(/\.archer-turn-summary\s*\{[^}]*border:/);
  expect(styles).toMatch(/\.archer-execution-notice\s*\{[^}]*border-left:\s*2px solid/);
  expect(styles).not.toMatch(/\.archer-execution-notice\s*\{[^}]*border-radius:/);
});

it('Agent 组头只使用已加载 Turn 的开始时间，缺失时不补造', () => {
  const withStart = renderToStaticMarkup(createElement(EventTimeline, { events: completed(true), active: false }));
  expect(withStart).toMatch(/class="archer-message-header"[\s\S]*?<time>/);
  const withoutStart = renderToStaticMarkup(createElement(EventTimeline, {
    events: completed(true).filter(event => event.fact.event.type !== 'turn.created'), active: false,
  }));
  expect(withoutStart).toContain('class="archer-message-header"');
  expect(withoutStart).not.toMatch(/class="archer-message-header"[\s\S]*?<time>/);
});
