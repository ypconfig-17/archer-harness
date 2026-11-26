/** 执行流按真实顺序呈现，人工交互与计划只使用已提交事实。 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { EventTimeline } from '../../../apps/desktop/renderer/src/ui/workspace/EventTimeline';
import { useProgress } from '../../../apps/desktop/renderer/src/store/progress';
import { CurrentPlan } from '../../../apps/desktop/renderer/src/ui/workspace/CurrentPlan';
import { buildItems, type TimelineEvent } from '../../../apps/desktop/renderer/src/lib/conversation';
import { planRecords } from '../../../apps/desktop/renderer/src/lib/task-insights';

const target = { providerId: 'files', capabilityId: 'read', contractId: 'archer.tool@1', revision: 'v2' };
function events(facts: { type: string; data: unknown }[]): TimelineEvent[] {
  return facts.map((event, seq) => ({
    id: `a:${seq}`, agentId: 'a', seq, ts: seq,
    fact: { scope: 'turn', turnId: 't', turnSeq: seq, event },
  })) as TimelineEvent[];
}
function call(effectId: string, input: unknown = {}, interaction?: 'human') {
  return { type: 'effect.created', data: {
    effectId, createdAt: 1, effect: { type: 'CALL', target, input, ...(interaction ? { interaction } : {}) },
  } };
}
function done(effectId: string, value: unknown) {
  return { type: 'effect.completed', data: { effectId, effectType: 'CALL', result: { value }, finishedAt: 2, durationMs: 1 } };
}
const infer = (effectId: string, content: string) => [
  { type: 'effect.created', data: { effectId, createdAt: 1, effect: {
    type: 'INFER', target: { ...target, contractId: 'archer.inference@1' }, messages: [], promptPrefixCount: 0,
  } } },
  { type: 'effect.completed', data: { effectId, effectType: 'INFER', result: { content }, finishedAt: 2 } },
];
const suspended = { type: 'effect.suspended', data: { effectId: 'ask', reason: '失败后如何处理？' } };
const render = (facts: TimelineEvent[], pending = false) => renderToStaticMarkup(createElement(EventTimeline, {
  events: facts, active: pending,
  ...(pending ? { pendingInteraction: {
    turnId: 't', effectId: 'ask', content: createElement('section', { 'aria-label': '等待你的回答' }, '回答表单'),
  } } : {}),
}));

it('询问在两段活动之间，回答后原位折叠且任务完成后仍可查看', () => {
  const facts = [
    ...infer('analysis', '先检查现有实现。'),
    call('read', { path: '/src/a.ts' }), done('read', { output: 'source' }),
    call('ask', { reason: '失败后如何处理？', options: ['终止', '继续'] }, 'human'), suspended,
  ];
  const pending = render(events(facts), true);
  expect(pending.indexOf('先检查现有实现')).toBeLessThan(pending.indexOf('读取文件'));
  expect(pending.indexOf('读取文件')).toBeLessThan(pending.indexOf('回答表单'));
  expect(pending.match(/回答表单/g)).toHaveLength(1);
  expect(pending).not.toContain('execution-stage-footer');
  const completed = render(events([
    ...facts,
    { type: 'effect.resumed', data: { effectId: 'ask', kind: 'human' } },
    done('ask', { approved: true, response: '终止' }),
    ...infer('continue', '按你的选择继续处理。'),
    ...infer('final', '最终结果。'),
    { type: 'turn.completed', data: { summary: '最终结果。', completedAt: 3 } },
  ]));
  expect(completed).toContain('class="archer-interaction-record"');
  expect(completed).toContain('已回答');
  expect(completed).not.toContain('已同意');
  expect(completed).not.toContain('回答表单');
  expect(completed.indexOf('已回答')).toBeLessThan(completed.indexOf('按你的选择继续处理'));
  expect(completed.match(/最终结果。/g)).toHaveLength(1);
  expect(completed).toContain('先检查现有实现');
});

it('命令授权记录使用独立语义，批准不等于命令执行成功', () => {
  const markup = render(events([
    call('ask', { command: 'pnpm test' }), suspended,
    { type: 'effect.resumed', data: { effectId: 'ask', kind: 'human' } },
    { type: 'effect.started', data: { effectId: 'ask', effectType: 'CALL', attempt: 1, startedAt: 2 } },
    { type: 'effect.failed', data: { effectId: 'ask', effectType: 'CALL', error: { message: 'failed' } } },
  ]));
  expect(markup).toContain('已授权本次命令');
  expect(markup).toContain('执行失败');
  expect(markup).not.toContain('已回答');
});

it('未知结果的对账在原操作处展示，缺少创建事实时明确加载边界且保留操作入口', () => {
  const unknown = events([
    call('ask', { command: 'write' }),
    { type: 'effect.unknown', data: { effectId: 'ask', lastKnownStatus: 'started' } },
  ]);
  expect(render(unknown, true)).toContain('回答表单');
  expect(render(unknown, true)).not.toContain('当前询问的起始记录尚未加载');
  expect(render([], true)).toContain('当前询问的起始记录尚未加载');
  expect(render([], true)).toContain('回答表单');
});

it('状态更新不堆叠计划节点，修订与下一份计划分别保留，历史可读最新阶段', () => {
  const plan = (revision: number, texts: string[], planId = 'a', completed = false) => ({ metadata: { plan: {
    planId, title: planId, revision,
    steps: texts.map(text => ({ text, status: completed ? 'completed' : 'pending' })),
  } } });
  const facts = events([
    call('p1'), done('p1', plan(1, ['分析'])),
    call('p2'), done('p2', plan(2, ['分析'], 'a', true)),
    call('p3'), done('p3', plan(3, ['分析', '验证'], 'a', true)),
    call('p4'), done('p4', plan(1, ['资源读取'], 'b')),
  ]);
  const records = planRecords(buildItems(facts).flatMap(item => item.kind === 'effect' ? [item.entry] : []));
  expect([...records.values()].map(record => record.kind)).toEqual(['created', 'progress', 'revised', 'created']);
  const markup = render(facts);
  expect(markup.match(/已创建计划|计划已完成/g)).toHaveLength(2);
  expect(markup.match(/已调整计划/g)).toHaveLength(1);
  expect(markup).toContain('计划更新记录');
  expect(markup).toContain('3 个版本');
  expect(markup).not.toContain('次计划声明</summary>');
  expect(markup).toContain('计划更新记录');
  expect(markup).toContain('第 1 版');
  expect(markup).toContain('第 3 版');
  expect(markup).toContain('已完成');
});

it('加载窗口从进度更新开始时，不冒充新建计划或结构修订', () => {
  const markup = render(events([
    call('partial'), done('partial', { metadata: { plan: {
      planId: 'a', title: '部分历史', revision: 4,
      steps: [{ text: '核对结果', status: 'in_progress' }],
    } } }),
  ]));
  expect(markup).toContain('已加载计划声明');
  expect(markup).toContain('创建及更早的声明尚未加载');
  expect(markup).not.toContain('已创建计划');
  expect(markup).not.toContain('已调整计划');
});

it('普通工具直接显示短行，失败操作独立可见，不生成工具组折叠树', () => {
  const successful = [
    call('a', { path: '/src/pom.xml' }), done('a', { output: 'config' }),
    call('b', { path: '/src/SharedKernel.java' }), done('b', { output: 'source' }),
  ];
  const markup = render(events(successful));
  expect(markup).toContain('pom.xml');
  expect(markup).toContain('SharedKernel.java');
  expect(markup.match(/data-slot="trace-collapsible"/g)).toHaveLength(2);
  expect(markup).not.toContain('tool-activity');
  expect(markup).not.toContain('process-flow');
  const failed = render(events([
    ...successful.slice(0, 3),
    { type: 'effect.failed', data: { effectId: 'b', effectType: 'CALL', error: { message: 'denied' } } },
    { type: 'turn.failed', data: { error: { message: 'failed' }, completedAt: 3 } },
  ]));
  expect(failed).toContain('SharedKernel.java');
  expect(failed.indexOf('执行失败')).toBeGreaterThan(failed.indexOf('SharedKernel.java'));
});

it('普通思考不逐次占行，公开进度与最终答复不重复，终态过程进入轻量记录', () => {
  const facts = [
    ...infer('a', '先检查目录。'),
    call('read', { path: '/src/a.ts' }), done('read', { output: 'source' }),
    ...infer('b', '接下来验证。'),
    ...infer('final', '最终结果。'),
    { type: 'turn.completed', data: { summary: '最终结果。', completedAt: 3 } },
  ];
  const markup = render(events(facts));
  expect(markup).toContain('class="activity-history"');
  expect(markup.indexOf('先检查目录')).toBeLessThan(markup.indexOf('读取文件'));
  expect(markup.indexOf('读取文件')).toBeLessThan(markup.indexOf('接下来验证'));
  expect(markup.match(/最终结果。/g)).toHaveLength(1);
  expect(markup).not.toContain('process-note');
  expect(markup).not.toContain('process-flow');
  expect(markup).not.toContain('仅已加载记录</small></summary><div class="activity-rows"></div>');
});

it('推理按原序生成单行入口，不再汇总到活动末尾，部分历史显示范围', () => {
  const withReasoning = (id: string, content: string) => [
    infer(id, content)[0],
    { type: 'effect.completed', data: { effectId: id, effectType: 'INFER', result: { content, reasoning: `reasoning-${id}` }, finishedAt: 2 } },
  ];
  const markup = render(events([
    ...withReasoning('a', '进度一'), ...withReasoning('b', '进度二'),
    { type: 'turn.completed', data: { summary: '其他结果', completedAt: 3 } },
  ] as { type: string; data: unknown }[]));
  // 每次推理各有一个"思考记录"入口，保持事件原序，不汇总到活动末尾。
  expect(markup.match(/data-slot="trace-title"[^>]*>思考记录/g)).toHaveLength(2);
  expect(markup).not.toContain('activity-reasoning');
  expect(markup.indexOf('进度一')).toBeLessThan(markup.indexOf('进度二'));
  expect(markup).toContain('过程记录');
  expect(markup).toContain('仅已加载记录');
});


it('推理结果未知时，对账表单同样原位可见，不被模型类型分支吞掉', () => {
  const markup = render(events([
    infer('ask', '')[0]!,
    { type: 'effect.unknown', data: { effectId: 'ask', lastKnownStatus: 'started', detectedAt: 3 } },
  ]), true);
  expect(markup.match(/回答表单/g)).toHaveLength(1);
  expect(markup).not.toContain('当前询问的起始记录尚未加载');
});


it('思考与工具按效果顺序交错，最终答复不在单行活动中重复', () => {
  const markup = render(events([
    infer('thinking', '')[0]!,
    { type: 'effect.completed', data: { effectId: 'thinking', effectType: 'INFER', result: { content: '', reasoning: '先检查目录\n再定位文件' }, finishedAt: 2 } },
    call('read', { path: '/a/b/LongFile.java' }), done('read', { output: 'source' }),
    ...infer('progress', '接下来核对测试'),
    ...infer('final', '最终答复'),
    { type: 'turn.completed', data: { summary: '最终答复', completedAt: 3 } },
  ]));
  expect(markup.indexOf('先检查目录 再定位文件')).toBeLessThan(markup.indexOf('LongFile.java'));
  expect(markup.indexOf('LongFile.java')).toBeLessThan(markup.indexOf('接下来核对测试'));
  expect(markup.replace(/<[^>]*>/g, '').match(/最终答复/g)).toHaveLength(1);
  expect(markup).not.toContain('思考记录 ·');
});


function renderCompact(facts: TimelineEvent[], active = false) {
  return renderToStaticMarkup(createElement(EventTimeline, { events: facts, active, compact: true }));
}

function planFacts(steps: { text: string; status: 'pending' | 'in_progress' | 'completed' }[], revision = 1) {
  return [
    call('plan', { action: 'create', planId: 'work', expectedRevision: null }),
    done('plan', { metadata: { plan: { planId: 'work', title: '检查代码', revision, steps } } }),
  ];
}

it('计划声明只保留一行事件，不进入执行摘要，调用明细默认收起', () => {
  const facts = [
    { type: 'turn.created', data: { createdAt: 1, allowShell: false } },
    ...planFacts([
      { text: '分析代码', status: 'completed' },
      { text: '校验结果', status: 'in_progress' },
    ]),
    call('read', { path: '/src/a.ts' }), done('read', { output: 'source' }),
  ];
  const running = renderToStaticMarkup(createElement(EventTimeline, {
    events: events(facts), active: true, compact: true, onInspectActivity: () => {},
  }));
  expect(running).not.toContain('role="progressbar"');
  // 计划只占一行：摘要文案与步骤都不进入执行正文，步骤仅在点击后的展开区。
  expect(running.match(/aria-label="计划事件"/g)).toHaveLength(1);
  expect(running).toContain('已创建计划 · 检查代码');
  expect(running).toContain('1/2 · 模型声明');
  expect(running.replace(/<[^>]*>/g, '').match(/分析代码/g)).toHaveLength(1);
  expect(running.indexOf('分析代码')).toBeGreaterThan(running.indexOf('data-slot="trace-collapsible-content"'));
  // 进行中的 Turn 在工具调用间隙保持「执行中」，避免顶部摘要文案反复切换。
  expect(running).toContain('执行中');
  expect(running).toContain('查看全部活动');
  expect(running).not.toContain('aria-label="简版执行记录"');
  const finished = renderCompact(events([
    ...facts,
    { type: 'turn.completed', data: { completedAt: 3, summary: '完成' } },
  ]));
  expect(finished).toContain('aria-label="计划事件"');
  // 调用明细仍需用户主动展开，累计摘要不连同明细一起摊开。
  expect(finished).not.toContain('aria-label="简版执行记录"');
  expect(finished).not.toContain('<details class="brief-activity" open');
});

it('纯进度更新不新增计划事件行，结构修订才多一行', () => {
  const facts = events([
    ...planFacts([{ text: '分析代码', status: 'pending' }]),
    call('p2'), done('p2', { metadata: { plan: {
      planId: 'work', title: '检查代码', revision: 2,
      steps: [{ text: '分析代码', status: 'completed' }],
    } } }),
    call('p3'), done('p3', { metadata: { plan: {
      planId: 'work', title: '检查代码', revision: 3,
      steps: [{ text: '分析代码', status: 'completed' }, { text: '补充验证', status: 'in_progress' }],
    } } }),
  ]);
  const markup = renderCompact(facts, true);
  expect(markup.match(/aria-label="计划事件"/g)).toHaveLength(2);
  expect(markup.match(/已创建计划|计划已完成/g)).toHaveLength(1);
  expect(markup.match(/已调整计划/g)).toHaveLength(1);
});

it('当前计划入口展示完整步骤，正文计划行只保留一行摘要', () => {
  const steps = Array.from({ length: 8 }, (_, index) => ({
    text: `原始步骤 ${index + 1}：核对实现，不补造阶段说明`,
    status: index < 5 ? 'completed' as const : index === 5 ? 'in_progress' as const : 'pending' as const,
  }));
  const facts = events([
    ...planFacts(steps),
    call('read', { path: '/src/a.ts' }), done('read', { output: 'source' }),
  ]);
  const dock = renderToStaticMarkup(createElement(CurrentPlan, { events: facts, turnId: 't' }));
  expect(dock).toContain('原始步骤 6：核对实现，不补造阶段说明');
  expect(dock).toContain('class="is-current"');
  expect(dock).toContain('当前计划');
  expect(dock).toContain('模型声明');
  expect(dock).toContain('5/8');
  const transcript = renderCompact(facts, true);
  expect(transcript).toContain('aria-label="计划事件"');
  expect(transcript).toContain('5/8 · 模型声明');
  expect(transcript).not.toContain('progress-paragraph');
  // 步骤只出现在计划事件的展开区，不会被投影成执行段落标题。
  expect(transcript.indexOf('原始步骤 6')).toBeGreaterThan(transcript.indexOf('data-slot="trace-collapsible-content"'));
});

it('Shell 调用只显示单行命令预览，完整参数留在调用详情', () => {
  const command = 'pnpm --filter @archer/desktop test --runInBand --reporter=verbose';
  const markup = renderCompact(events([
    call('sh', { command, cwd: '/repo' }), done('sh', { output: 'ok' }),
  ]));
  expect(markup).toContain(`title="${command}"`);
  expect(markup).toContain(`>${command}<`);
  expect(markup).toContain('执行命令');
});

it('折叠不改变工具活动顺序，失败调用在原位置可见', () => {
  const markup = renderCompact(events([
    call('a', { path: '/src/a.txt' }), done('a', { output: 'a' }),
    call('b', { path: '/src/b.txt' }),
    { type: 'effect.failed', data: { effectId: 'b', effectType: 'CALL', error: { message: 'denied' } } },
    call('c', { path: '/src/c.txt' }), done('c', { output: 'c' }),
  ]));
  expect(markup.indexOf('a.txt')).toBeLessThan(markup.indexOf('执行失败'));
  expect(markup.indexOf('执行失败')).toBeLessThan(markup.indexOf('c.txt'));
});

it('没有公开反馈时只显示中性工具组，不生成阶段标题', () => {
  const markup = renderCompact(events([
    call('read', { path: '/src/a.ts' }), done('read', { output: 'source' }),
  ]));
  expect(markup).not.toContain('class="progress-paragraph"');
  expect(markup).not.toContain('has-prose');
  expect(markup).toContain('工具活动 · 1 次调用');
  expect(markup).not.toContain('正在分析');
  expect(markup).not.toContain('正在修复');
});

it('调用短行展示已记录耗时，摘要汇总文件修改数', () => {
  const markup = renderCompact(events([
    call('edit', { path: '/src/a.ts' }),
    { type: 'effect.completed', data: { effectId: 'edit', effectType: 'CALL', durationMs: 640, finishedAt: 2,
      result: { value: { metadata: { fileChange: { path: '/src/a.ts', after: 'next' } } } } } },
    call('read', { path: '/src/a.ts' }), done('read', { output: 'next' }),
  ]));
  expect(markup).toContain('640 ms');
  expect(markup).toContain('1 个文件修改');
  expect(markup).toContain('工具活动 · 2 次调用');
});

it('原始推理默认不进入主对话', () => {
  const markup = renderCompact(events([
    ...infer('private', ''),
    { type: 'effect.completed', data: { effectId: 'private', effectType: 'INFER', result: { content: '', reasoning: '内部推理原文' }, finishedAt: 2 } },
    call('read', { path: '/src/a.ts' }), done('read', { output: 'source' }),
  ]));
  expect(markup).not.toContain('内部推理原文');
  expect(markup).not.toContain('inference-activity-row');
  expect(markup).not.toContain('progress-paragraph');
});

it('Agent 头部在执行之前出现且最终答复不重复头部', () => {
  const html = render(events([
    ...infer('analysis', '检查中'),
    call('read'), done('read', { output: 'ok' }),
    { type: 'turn.completed', data: { summary: '完成检查', completedAt: 3 } },
  ]));
  expect(html.match(/<strong>Archer<\/strong>/g)).toHaveLength(1);
  expect(html.indexOf('<strong>Archer</strong>')).toBeLessThan(html.indexOf('读取文件'));
});

it('简版人工交互前后共用一个累计执行摘要', () => {
  const html = renderCompact(events([
    call('read'), done('read', { output: 'ok' }),
    call('ask', {}, 'human'), suspended,
    { type: 'effect.resumed', data: { effectId: 'ask', kind: 'human' } },
    done('ask', { approved: true, response: '继续' }),
    call('read-again'), done('read-again', { output: 'ok' }),
    { type: 'turn.completed', data: { summary: '完成', completedAt: 3 } },
  ]));
  expect(html.match(/aria-label="本轮执行摘要"/g)).toHaveLength(1);
  expect(html).toContain('此前 2 次调用已完成');
  expect(html).toContain('已回答');
});

it('简版累计摘要不替代人工交互前后的公开活动', () => {
  const html = renderCompact(events([
    ...infer('before', '先检查资源读取'),
    call('ask', {}, 'human'), suspended,
    { type: 'effect.resumed', data: { effectId: 'ask', kind: 'human' } },
    done('ask', { approved: true, response: '继续' }),
    ...infer('after', '继续验证同名冲突'),
    call('read'), done('read', { output: 'ok' }),
  ]));
  expect(html.indexOf('先检查资源读取')).toBeLessThan(html.indexOf('已回答'));
  expect(html.indexOf('已回答')).toBeLessThan(html.indexOf('继续验证同名冲突'));
});

it('简版公开反馈成为正文，连续工具分组且原始推理不泄漏到主流', () => {
  const html = renderCompact(events([
    ...infer('first', '先核对资源读取。'),
    call('one'), done('one', { output: 'ok' }),
    call('two'), done('two', { output: 'ok' }),
    ...infer('next', '已定位问题，继续检查。'),
    call('three'), done('three', { output: 'ok' }),
  ]));
  expect(html.match(/class="progress-paragraph"/g)).toHaveLength(2);
  expect(html.match(/conversation-work-segment has-prose/g)).toHaveLength(2);
  expect(html.match(/aria-label="工具活动"/g)).toHaveLength(2);
  expect(html.indexOf('先核对资源读取。')).toBeLessThan(html.indexOf('工具活动 · 2'));
  expect(html.indexOf('工具活动 · 2')).toBeLessThan(html.indexOf('已定位问题，继续检查。'));
});

const inferOpen = (effectId: string) => [
  { type: 'effect.created', data: { effectId, createdAt: 1, effect: {
    type: 'INFER', target: { ...target, contractId: 'archer.inference@1' }, messages: [], promptPrefixCount: 0,
  } } },
  { type: 'effect.started', data: { effectId, effectType: 'INFER', startedAt: 1, attempt: 1 } },
];
const frame = (effectId: string, content: string, phase: 'generating' | 'settled' | 'interrupted', agentId = 'a') => ({
  agentId, turnId: 't', effectId, phase, content,
}) as never;
const renderStreaming = (facts: TimelineEvent[], progress: Record<string, unknown>, active = true) =>
  renderToStaticMarkup(createElement(EventTimeline, {
    events: facts, active, compact: true, progress: progress as never, onInspectActivity: () => {},
  }));

it('未提交正文作为临时预览出现，并标明还不是正式事实', () => {
  const streaming = renderStreaming(events(inferOpen('live')), { live: frame('live', '正在核对读写的边界', 'generating') });
  expect(streaming).toContain('class="progress-paragraph"');
  // 不依赖动画帧补播：生成态立即显示当前累计正文，不附加块状黑框光标。
  expect(streaming).toContain('正在核对读写的边界');
  expect(streaming).not.toContain('--streamdown-caret');
  const settled = renderStreaming(events(inferOpen('live')), { live: frame('live', '正在核对读写的边界', 'settled') });
  expect(settled).toContain('正在核对读写的边界');
  expect(settled).not.toContain('--streamdown-caret');
  expect(streaming).toContain('生成中 · 未提交');
  // 推理原文仍不进对话主线，只随完整活动阅读。
  const interrupted = renderStreaming(events(inferOpen('live')), { live: frame('live', '中断前的预览', 'interrupted') });
  expect(interrupted).toContain('已中断 · 未提交');
  expect(interrupted).toContain('中断前的预览');
  expect(interrupted).not.toContain('--streamdown-caret');
  expect(interrupted).not.toContain('生成中');
});

it('累计正文增长时立即显示新内容，不等待结束或动画帧补播', () => {
  const facts = events(inferOpen('live'));
  for (const text of ['看得懂', '看得懂，我重新输出', '看得懂，我重新输出这张图的内容']) {
    const markup = renderStreaming(facts, { live: frame('live', text, 'generating') });
    expect(markup).toContain(text);
    expect(markup).toContain('生成中 · 未提交');
  }
});

it('提交后临时预览原位替换为正式答复，不出现双份正文', () => {
  const progress = { live: frame('live', '正在核对读写的边界', 'generating') };
  const committed = renderStreaming(events([
    ...inferOpen('live'),
    { type: 'effect.completed', data: { effectId: 'live', effectType: 'INFER', result: { content: '正在核对读写的边界' }, finishedAt: 2 } },
    { type: 'turn.completed', data: { summary: '正在核对读写的边界', completedAt: 3 } },
  ]), progress, false);
  expect(committed.match(/正在核对读写的边界/g)).toHaveLength(1);
  expect(committed).not.toContain('未提交');
  expect(committed).toContain('class="archer-assistant-answer"');
});

it('离开会话后临时流被丢弃，另一个 Agent 的预览不受影响', () => {
  useProgress.getState().update(frame('a-live', '甲的预览', 'generating'));
  useProgress.getState().update(frame('b-live', '乙的预览', 'generating', 'b'));
  useProgress.getState().release('a');
  expect(useProgress.getState().frames['a']).toBeUndefined();
  expect(Object.keys(useProgress.getState().frames['b'] ?? {})).toEqual(['b-live']);
});

function callTool(effectId: string, capabilityId: string, input: unknown = {}) {
  return { type: 'effect.created', data: {
    effectId, createdAt: 1, effect: { type: 'CALL', target: { ...target, capabilityId }, input },
  } };
}

it('折叠工具组按真实调用类别汇总读取、修改与执行', () => {
  const markup = renderCompact(events([
    callTool('r', 'read', { path: '/src/a.ts' }), done('r', { output: 'a' }),
    callTool('w', 'edit', { path: '/src/b.ts' }), done('w', { output: 'b' }),
    callTool('x', 'bash', { command: 'pnpm test' }), done('x', { output: 'ok' }),
  ]));
  expect(markup).toContain('读取 1 次 · 修改 1 次 · 执行 1 次');
});

it('失败与停止使用正文层级状态，不再生成输入框式错误卡片', () => {
  const failed = renderCompact(events([
    ...infer('i', '准备执行。'),
    { type: 'turn.failed', data: { error: { message: 'provider down' }, completedAt: 3 } },
  ]));
  expect(failed).toContain('turn-execution-receipt');
  expect(failed).toContain('data-status="failed"');
  expect(failed).toContain('provider down');
  const cancelled = renderCompact(events([
    ...infer('i', '准备执行。'),
    { type: 'turn.cancelled', data: { reason: 'user', completedAt: 3 } },
  ]));
  expect(cancelled).not.toContain('archer-execution-notice');
  expect(cancelled).toContain('已停止');
});

it('同一绘制批次保留不同推理的最新快照，并只通知一次订阅者', () => {
  let notifications = 0;
  const unsubscribe = useProgress.subscribe(() => { notifications++; });
  try {
    useProgress.getState().update(
      frame('batch-old', '上一段收束', 'settled', 'batch-agent'),
      frame('batch-current', '下一段正文', 'generating', 'batch-agent'),
    );
    expect(notifications).toBe(1);
    expect(useProgress.getState().frames['batch-agent']?.['batch-old']?.phase).toBe('settled');
    expect(useProgress.getState().frames['batch-agent']?.['batch-current']?.content).toBe('下一段正文');
  } finally {
    unsubscribe();
    useProgress.getState().release('batch-agent');
  }
});

it('传入 agentId 时叶节点只读取对应 agentId 与 effectId 的快照边界', () => {
  const facts = events(inferOpen('leaf-live'));
  try {
    useProgress.getState().update(
      frame('leaf-live', '叶节点订阅正文', 'generating', 'leaf-agent'),
      frame('other-live', '其他会话正文', 'generating', 'other-agent'),
    );
    expect(useProgress.getState().frames['leaf-agent']?.['leaf-live']?.content).toBe('叶节点订阅正文');
    expect(useProgress.getState().frames['leaf-agent']?.['other-live']).toBeUndefined();
    const html = renderToStaticMarkup(createElement(EventTimeline, {
      events: facts, active: true, compact: true, agentId: 'leaf-agent', onInspectActivity: () => {},
    }));
    expect(html).toContain('waiting'.includes('w') ? '等待模型响应…' : '');
  } finally {
    useProgress.getState().release('leaf-agent');
    useProgress.getState().release('other-agent');
  }
});

it.each(['turn.failed', 'turn.cancelled', 'turn.completed'])('终态 %s 停止计划动画但不补造完成进度', type => {
  const facts = events([
    call('plan'), done('plan', { metadata: { plan: {
      planId: 'review', title: '检查', revision: 1,
      steps: [{ text: '核对结果', status: 'in_progress' }],
    } } }),
    { type, data: { error: { message: '余额不足' }, reason: 'aborted', completedAt: 3, failedAt: 3, cancelledAt: 3 } },
  ]);
  const markup = render(facts);
  expect(markup).toContain('计划未完成 · 执行已结束');
  expect(markup).toContain('0/1');
  expect(markup).toContain('data-plan-status="stopped"');
  expect(markup).not.toContain('aria-label="进行中"');
});

it('等待提示跟随当前署名，真实思考流与正文分别替换等待反馈', async () => {
  const { JSDOM } = await import('jsdom');
  const facts = events(inferOpen('live'));
  const waiting = renderStreaming(facts, {});
  const document = new JSDOM(waiting).window.document;
  const status = document.querySelector('.workspace-turn-group .execution-stage-footer');
  expect(status?.textContent).toBe('等待模型响应…');
  expect(status?.querySelector('.ui-spinner')).not.toBeNull();
  expect(document.querySelectorAll('.execution-stage-footer')).toHaveLength(1);
  const reasoning = renderStreaming(facts, {
    live: { agentId: 'a', turnId: 't', effectId: 'live', phase: 'generating', content: '', reasoning: '明确收到的思考分块' },
  });
  expect(reasoning).toContain('正在思考…');
  expect(reasoning).not.toContain('等待模型响应…');
  const streaming = renderStreaming(facts, { live: frame('live', '回复正在生成', 'generating') });
  expect(streaming).toContain('回复正在生成');
  expect(streaming).not.toContain('execution-stage-footer');
  const interrupted = renderStreaming(facts, { live: frame('live', '', 'interrupted') });
  expect(interrupted).toContain('推理已中断，等待确认');
});

it('紧凑对话的署名与累计活动共享顶部行，正文保留在其下方', async () => {
  const { JSDOM } = await import('jsdom');
  const markup = renderStreaming(events([
    call('read', { path: '/src/a.ts' }), done('read', { output: 'source' }),
    ...infer('final', '最终答复正文'),
    { type: 'turn.completed', data: { summary: '最终答复正文', completedAt: 3 } },
  ]), {}, false);
  const document = new JSDOM(markup).window.document;
  const heading = document.querySelector('.workspace-turn-heading')!;
  expect(heading.querySelector('.archer-message-header')?.textContent).toContain('Archer');
  expect(heading.querySelector('[aria-label="本轮执行摘要"]')?.textContent).toContain('1 次调用');
  expect(heading.textContent).toContain('查看全部活动');
  expect(heading.textContent).not.toContain('最终答复正文');
  expect(document.querySelectorAll('[aria-label="本轮执行摘要"]')).toHaveLength(1);
});
