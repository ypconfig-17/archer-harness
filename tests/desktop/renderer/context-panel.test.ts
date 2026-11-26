/** 上下文页只读取已提交请求快照；请求、待执行意图与整理事实分别表达。 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentEvent, Snapshot } from '@archer/contracts';
import { describe, expect, it } from 'vitest';
import { contextComposition } from '../../../apps/desktop/renderer/src/lib/context-composition';
import { contextEntryGroups } from '../../../apps/desktop/renderer/src/lib/context-entries';
import { contextRequests } from '../../../apps/desktop/renderer/src/lib/context-requests';
import { compactTokens, contextTrend } from '../../../apps/desktop/renderer/src/lib/context-trend';
import { buildItems } from '../../../apps/desktop/renderer/src/lib/conversation';
import { ContextPanel } from '../../../apps/desktop/renderer/src/ui/panels/ContextPanel';

const TARGET = { providerId: 'pi', capabilityId: 'inference', contractId: 'archer.inference@1', revision: 'pi@1' };

function inferEffect() {
  return {
    type: 'INFER' as const,
    target: TARGET,
    messages: [
      { role: 'system' as const, content: 'You are Archer.' },
      { role: 'user' as const, content: '检查工作区状态' },
    ],
    tools: [{
      name: 'files_read',
      target: { providerId: 'files', capabilityId: 'read', contractId: 'archer.tool@1', revision: 'files@1' },
      description: '读取工作区文件',
      parameters: {},
    }],
    promptPrefixCount: 1,
    contextProjection: { originalChars: 48_000, projectedChars: 18_000, summarizedMessages: 12 },
    config: { model: 'gpt-5', reasoning: 'medium' as const },
  };
}

function turn(seq: number, type: string, data: unknown): Snapshot<AgentEvent> {
  return {
    id: `a:${seq}`,
    agentId: 'a',
    seq,
    ts: 100 + seq,
    fact: { scope: 'turn', turnId: 'a:t1', turnSeq: seq, event: { type, data } },
  } as Snapshot<AgentEvent>;
}

function requestEvents({ seq = 0, effectId = 'e1', requestId = 'r1', promptTokens = 1200 } = {}) {
  const effect = inferEffect();
  return [
    turn(seq + 1, 'effect.created', { effectId, effect, idempotencyKey: `k-${effectId}`, createdAt: 100 }),
    turn(seq + 2, 'inference.requested', { effectId, requestId, purpose: 'agent', request: effect, requestedAt: 1_000 + seq }),
    turn(seq + 3, 'inference.responded', {
      effectId,
      requestId,
      respondedAt: 2_000 + seq,
      result: {
        content: '工作区可用',
        usage: { promptTokens, completionTokens: 300, cacheReadTokens: 800, cacheWriteTokens: 0 },
        reasoningLevel: 'medium',
        preparations: [{ ref: { providerId: 'files', capabilityId: 'read', contractId: 'archer.tool@1', revision: 'files@1' }, input: { path: 'README.md' } }],
        contextPlan: {
          profileId: 'balanced',
          profileName: '均衡',
          profileRevision: 2,
          beforeTokens: 80_000,
          afterTokens: 30_000,
          inputLimit: 100_000,
          steps: [{ stepId: 'compact-history', kind: 'compact', reason: 'growth', beforeTokens: 80_000, afterTokens: 30_000 }],
        },
      },
    }),
  ];
}

describe('上下文请求投影', () => {
  it('同一 Effect 的多次请求分别成项，待执行意图不冒充已提交快照', () => {
    const effect = inferEffect();
    const entries = buildItems([
      turn(1, 'effect.created', { effectId: 'e1', effect, idempotencyKey: 'k1', createdAt: 100 }),
      turn(2, 'inference.requested', { effectId: 'e1', requestId: 'r1', purpose: 'agent', request: effect, requestedAt: 1_000 }),
      turn(3, 'inference.requested', { effectId: 'e1', requestId: 'r2', purpose: 'compaction', request: effect, requestedAt: 1_500 }),
    ]).flatMap(item => item.kind === 'effect' ? [item.entry] : []);
    const requests = contextRequests(entries);
    expect(requests).toHaveLength(2);
    expect(requests.map(request => [request.requestId, request.sent, request.purpose])).toEqual([
      ['r1', true, 'agent'],
      ['r2', true, 'compaction'],
    ]);
    const unsent = contextRequests(buildItems([
      turn(1, 'effect.created', { effectId: 'e2', effect, idempotencyKey: 'k2', createdAt: 100 }),
    ]).flatMap(item => item.kind === 'effect' ? [item.entry] : []));
    expect(unsent).toMatchObject([{ sent: false, usage: undefined, reasoningLevel: 'medium' }]);
  });
});

describe('字符占用与条目分组', () => {
  const request = contextRequests(buildItems(requestEvents()).flatMap(item => item.kind === 'effect' ? [item.entry] : []))[0]!;

  it('按请求快照的字符数分类，不把分类占比伪装成 Token', () => {
    const slices = contextComposition(request);
    expect(slices.map(slice => [slice.key, slice.chars])).toEqual([
      ['conversation', 7],
      ['results', 0],
      ['declarations', JSON.stringify(inferEffect().tools).length],
      ['system', 15],
      ['references', JSON.stringify(request.preparations).length],
    ]);
    expect(slices.map(slice => slice.share).reduce((sum, share) => sum + share, 0)).toBeGreaterThan(99);
  });

  it('没有任何可统计内容时占比全部为零', () => {
    const empty = { ...request, preparations: undefined, effect: { ...request.effect, messages: [], tools: [], preparations: undefined } };
    expect(contextComposition(empty).map(slice => slice.share)).toEqual([0, 0, 0, 0, 0]);
  });

  it('消息按角色分组，工具声明与参考整理各自成组，空分组不出现', () => {
    const groups = contextEntryGroups(request);
    expect(groups.map(group => [group.key, group.entries.length])).toEqual([
      ['system', 1],
      ['user', 1],
      ['declarations', 1],
      ['references', 2],
    ]);
    expect(groups.flatMap(group => group.entries.map(entry => entry.title))).toEqual([
      '系统指令 · 1',
      '用户消息 · 2',
      'files.read',
      '推理前参考结果',
      '上下文整理事实',
    ]);
    expect(groups.at(-1)!.entries.map(entry => entry.selection.kind)).toEqual(['preparations', 'projection']);
  });
});

describe('上下文 Token 趋势', () => {
  const request = contextRequests(buildItems(requestEvents()).flatMap(item => item.kind === 'effect' ? [item.entry] : []))[0]!;
  const withUsage = (key: string, promptTokens: number | undefined) => ({
    ...request,
    key,
    usage: promptTokens === undefined ? undefined : { ...request.usage!, promptTokens },
  });
  const requests = [withUsage('r1', 1_000), withUsage('r2', undefined), withUsage('r3', 3_000)];

  it('柱高只取真实输入 Token，缺失用量保留位置但不画柱', () => {
    const trend = contextTrend(requests, 2);
    expect(trend.points.map(point => [point.key, point.label, point.tokens])).toEqual([
      ['r2', '#2', undefined],
      ['r3', '#3', 3_000],
    ]);
    expect(trend.max).toBe(3_000);
  });

  it('分段沿用请求快照字符占比，不拆分出分类 Token', () => {
    const [point] = contextTrend([requests[2]!], 9).points;
    expect(point!.segments.map(segment => segment.key)).toEqual([
      'conversation',
      'results',
      'declarations',
      'system',
      'references',
    ]);
    expect(point!.segments.reduce((sum, segment) => sum + segment.share, 0)).toBeGreaterThan(99);
  });

  it('limit 为零时包含全部请求，刻度使用紧凑单位', () => {
    expect(contextTrend(requests, 0).points.map(point => point.key)).toEqual(['r1', 'r2', 'r3']);
    expect([0, 950, 1_000, 12_500, 25_720].map(compactTokens)).toEqual(['0', '950', '1K', '12.5K', '25.7K']);
  });
});

describe('上下文页', () => {
  it('请求列表、字符占用、条目与整理事实都来自已提交快照', () => {
    const html = renderToStaticMarkup(createElement(ContextPanel, { events: requestEvents() }));
    expect(html).toContain('上下文扫描');
    expect(html).toContain('已加载 1 个请求');
    expect(html).toContain('最近请求（随记录更新）');
    expect(html).toContain('#1 / 1');
    expect(html).toContain('输入 Token');
    expect(html).toContain('占额度 1.2%（100,000）');
    expect(html).toContain('缓存 Token');
    expect(html).toContain('占输入 66.7%');
    expect(html).toContain('按请求快照中的字符数统计');
    expect(html).toContain('字符占用');
    expect(html).toContain('context-bar-row');
    expect(html).toContain('上下文 Token 趋势');
    expect(html).toContain('最近 9 次');
    expect(html).toContain('趋势范围');
    expect(html).toContain('首次请求');
    expect(html).toContain('context-trend-seg is-system');
    expect(html).toContain('不是模型实际分类用量');
    expect(html).toContain('系统指令');
    expect(html).toContain('用户消息');
    expect(html).toContain('工具声明');
    expect(html).toContain('参考与整理');
    expect(html).toContain('原始内容');
    expect(html).toContain('均衡 · revision 2');
    expect(html).toContain('输入 1,200 · 输出 300 tokens');
    expect(html).toContain('推理等级</dt><dd>中');
    expect(html).toContain('摘要替换');
  });

  it('条目分组默认全部折叠，首屏只保留分组标题与计数', () => {
    const html = renderToStaticMarkup(createElement(ContextPanel, { events: requestEvents() }));
    expect(html).toContain('context-group-trigger');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('context-row');
    expect(html).not.toContain('系统指令 · 1');
    expect(html).not.toContain('上下文整理事实');
  });

  it('趋势与较上次变化只使用真实输入用量', () => {
    const events = [
      ...requestEvents(),
      ...requestEvents({ seq: 10, effectId: 'e2', requestId: 'r2', promptTokens: 900 }),
    ];
    const html = renderToStaticMarkup(createElement(ContextPanel, { events }));
    expect(html).toContain('当前请求 #2');
    expect(html).toContain('较上次 ↓ 25.0%（-300）');
    expect(html).toContain('#2 / 2');
    expect(html).toContain('已加载 2 个请求');
  });

  it('最近请求贴近右缘时数值徽标向内对齐', () => {
    const events = Array.from({ length: 9 }, (_, position) => requestEvents({
      seq: position * 10,
      effectId: `e${position}`,
      requestId: `r${position}`,
    })).flat();
    const html = renderToStaticMarkup(createElement(ContextPanel, { events }));
    expect(html).toContain('context-trend-badge is-end');
  });

  it('只有待执行意图时不绘制空趋势坐标轴', () => {
    const events = [turn(1, 'effect.created', {
      effectId: 'e1',
      effect: inferEffect(),
      idempotencyKey: 'k1',
      createdAt: 100,
    })];
    const html = renderToStaticMarkup(createElement(ContextPanel, { events }));
    expect(html).toContain('暂无可对比的已提交用量');
    expect(html).not.toContain('context-trend-axis');
    expect(html).toContain('待执行意图');
  });

  it('没有推理请求时给出空状态，并区分尚未加载的历史', () => {
    const html = renderToStaticMarkup(createElement(ContextPanel, { events: [], hasEarlier: true }));
    expect(html).toContain('尚无推理上下文');
    expect(html).toContain('可加载更早记录');
  });

  it('当前请求缺失用量时不误报为上次无用量，零步骤整理不展示空步骤折叠', () => {
    const first = requestEvents();
    const failedEffect = inferEffect();
    const second = [
      turn(11, 'effect.created', { effectId: 'e2', effect: failedEffect, idempotencyKey: 'k-e2', createdAt: 200 }),
      turn(12, 'inference.requested', { effectId: 'e2', requestId: 'r2', purpose: 'agent', request: failedEffect, requestedAt: 1_200 }),
      turn(13, 'inference.responded', {
        effectId: 'e2',
        requestId: 'r2',
        respondedAt: 2_200,
        result: {
          content: '',
          error: { message: 'timeout' },
          contextPlan: {
            profileId: 'balanced',
            profileName: '均衡',
            profileRevision: 1,
            beforeTokens: 2_000,
            afterTokens: 2_000,
            inputLimit: 100_000,
            steps: [],
          },
        },
      }),
    ];
    const html = renderToStaticMarkup(createElement(ContextPanel, { events: [...first, ...second] }));
    expect(html).toContain('当前请求无用量');
    expect(html).not.toContain('上次无用量');
    expect(html).toContain('未触发压缩 · 估算 2,000 / 100,000 tokens');
    expect(html).not.toContain('整理步骤 · 0');
  });
});
