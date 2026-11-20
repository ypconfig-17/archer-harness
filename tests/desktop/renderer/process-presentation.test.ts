/** 展示按执行事实表达目标、失败与归属，不把意图当成结果。 */
import { describe, expect, it } from 'vitest';
import { buildItems, type TimelineEvent, type EffectEntry } from '../../../apps/desktop/renderer/src/lib/conversation';
import { operationSummary, operationDisplay, operationState, fileChange } from '../../../apps/desktop/renderer/src/lib/operation';
import { activitySections, activityWindow, turnPresentations } from '../../../apps/desktop/renderer/src/lib/transcript';
function fact(seq: number, turnId: string, type: string, data: unknown): TimelineEvent {
  return { id: String(seq), agentId: 'a', seq, ts: seq, fact: { scope: 'turn', turnId, turnSeq: seq, event: { type, data } } } as TimelineEvent;
}
function command(exitCode: number): EffectEntry {
  return { effectId: 'e', turnId: 't', createdAt: 1, attempt: 1, effectType: 'CALL', effect: { type: 'CALL', target: { providerId: 'test', capabilityId: 'operation', contractId: 'archer.tool@1', revision: 'test-source' }, input: { command: 'pnpm test' } }, end: { type: 'effect.completed', data: { effectId: 'e', effectType: 'CALL', result: { value: { metadata: { command: { command: 'pnpm test', cwd: '/project', stdout: '', stderr: 'Tests failed', exitCode } } } }, durationMs: 50, finishedAt: 100 } } };
}
describe('操作展示', () => {
  it('命令调用正常返回也要按非零退出码展示失败', () => {
    expect(operationState(command(1))).toMatchObject({ tone: 'error', label: '命令失败', detail: '退出码 1' });
    expect(operationState(command(0)).tone).toBe('ok');
    expect(operationSummary(command(1))).toEqual({ title: '执行命令', target: 'pnpm test', detail: '/project' });
  });
  it('请求里的编辑内容不能伪装成已应用 diff', () => {
    const entry = { ...command(0), end: undefined, effect: { type: 'CALL' as const, target: { providerId: 'test', capabilityId: 'edit', contractId: 'archer.tool@1', revision: 'test-source' }, input: { path: '/src/a.ts', old_string: 'a', new_string: 'b' } } };
    expect(fileChange(entry)).toBeNull();
    expect(operationSummary(entry)).toMatchObject({ title: '编辑文件', target: '/src/a.ts' });
  });
  it('人工放弃追踪后仍明确保留结果未知', () => {
    expect(operationState({ ...command(0), abandonedReason: '已停止追踪' })).toMatchObject({ tone: 'warning', label: '已放弃追踪', detail: expect.stringContaining('仍未知') });
  });
  it('重试清除旧结果并展示新 attempt，不把上一轮未知当作本轮结果', () => {
    const items = buildItems([
      fact(1, 't', 'effect.created', { effectId: 'e', effect: { type: 'CALL', target: { providerId: 'test', capabilityId: 'operation', contractId: 'archer.tool@1', revision: 'test-source' }, input: 'test' }, createdAt: 1 }),
      fact(2, 't', 'effect.started', { effectId: 'e', effectType: 'CALL', attempt: 1, startedAt: 2 }),
      fact(3, 't', 'effect.unknown', { effectId: 'e', lastKnownStatus: 'started', detectedAt: 3 }),
      fact(4, 't', 'effect.resumed', { effectId: 'e', attempt: 1, kind: 'reconcile_retry', resumedAt: 4 }),
      fact(5, 't', 'effect.started', { effectId: 'e', effectType: 'CALL', attempt: 2, startedAt: 5 }),
    ]);
    const item = items[0];
    expect(item).toMatchObject({ kind: 'effect', entry: { attempt: 2, startedAt: 5 } });
    if (item?.kind === 'effect') expect(operationState(item.entry).label).toBe('进行中');
  });
});
describe('Turn 汇总', () => {
  it('多个 Turn 的答案、用量和耗时各自归属，不受其他输入或事件插入影响', () => {
    const events: TimelineEvent[] = [];
    for (const [index, id] of ['t1', 't2'].entries()) {
      const seq = index * 7;
      events.push(fact(seq + 1, id, 'turn.created', { createdAt: seq + 1, allowShell: false }));
      events.push(fact(seq + 2, id, 'effect.created', { effectId: id, createdAt: seq + 2, effect: { promptPrefixCount: 0, type: 'INFER', target: { providerId: 'inference', capabilityId: 'model', contractId: 'archer.inference@1', revision: 'test' }, messages: [], config: { model: id } } }));
      const request = { promptPrefixCount: 0, type: 'INFER', target: { providerId: 'inference', capabilityId: 'model', contractId: 'archer.inference@1', revision: 'test' }, messages: [], config: { model: id } };
      const result = { content: id, usage: { promptTokens: 10 + index, completionTokens: 3 } };
      events.push(fact(seq + 3, id, 'inference.requested', { effectId: id, requestId: `${id}:r1`, purpose: 'agent', request, requestedAt: seq + 3 }));
      events.push(fact(seq + 4, id, 'inference.responded', { effectId: id, requestId: `${id}:r1`, result, respondedAt: seq + 4 }));
      events.push(fact(seq + 5, id, 'effect.completed', { effectId: id, effectType: 'INFER', result, durationMs: 1, finishedAt: seq + 5 }));
      events.push(fact(seq + 6, id, 'turn.completed', { summary: id, stopReason: 'done', completedAt: seq + 6 }));
    }
    const turns = turnPresentations(buildItems(events));
    expect(turns.get('t1')).toMatchObject({ answer: 't1', finalEffectId: 't1', startedAt: 1, endedAt: 6, usage: { promptTokens: 10, completionTokens: 3 } });
    expect(turns.get('t2')).toMatchObject({ answer: 't2', models: ['t2'], usage: { promptTokens: 11, completionTokens: 3 } });
  });
});
describe('模型过程与工具交错展示', () => {
  it('长任务的中间模型输出不会产生最终回复或完成时间', () => {
    const items = buildItems([
      fact(1, 't', 'turn.created', { createdAt: 1, allowShell: false }),
      fact(2, 't', 'effect.created', { effectId: 'infer', createdAt: 2, effect: { promptPrefixCount: 0, type: 'INFER', target: { providerId: 'inference', capabilityId: 'model', contractId: 'archer.inference@1', revision: 'test' }, messages: [] } }),
      fact(3, 't', 'effect.completed', { effectId: 'infer', effectType: 'INFER', result: { content: '接下来检查文件', reasoning: '需要先检查' }, durationMs: 1, finishedAt: 3 }),
    ]);
    const turn = turnPresentations(items).get('t');
    expect(turn?.answer).toBeUndefined();
    expect(turn?.endedAt).toBeUndefined();
    expect(turn?.finalEffectId).toBeUndefined();
  });
});


describe('紧凑活动与历史收敛', () => {
  const tool = (seq: number, turnId = 't') => ({
    kind: 'effect' as const, seq, turnId, entry: { ...command(0), effectId: `call${seq}`, turnId },
  });
  const inference = (seq: number) => ({
    ...tool(seq), entry: { ...command(0), effectId: `infer${seq}`, effectType: 'INFER' as const },
  });
  it('平铺片段保留推理/工具/回执顺序，补充输入和跨轮活动保持边界', () => {
    const notice = { kind: 'notice' as const, seq: 3, turnId: 't', tone: 'info' as const, text: '命令授权已调整：完全访问' };
    const user = { kind: 'user' as const, seq: 4, label: '引导', text: '补充', at: 4 };
    const input = [tool(1), inference(2), notice, user, tool(5), tool(6, 'other')];
    const before = JSON.stringify(input);
    const sections = activitySections(input);
    expect(sections.map(item => item.kind)).toEqual(['activity', 'user', 'activity', 'activity']);
    expect(sections[0]).toMatchObject({ seq: 1, items: [input[0], input[1], notice] });
    expect(sections[1]).toBe(user);
    expect(activitySections([input[0]!])[0]?.seq).toBe(sections[0]?.seq);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('当前表单、失败、取消和未知结果始终独立，不受授权已恢复标记影响', () => {
    const item = tool(1);
    expect(activitySections([item], { turnId: 't', effectId: 'call1' })[0]).toBe(item);
    for (const type of ['effect.failed', 'effect.unknown', 'effect.cancelled'] as const) {
      const entry = { ...item, entry: { ...item.entry, end: { type, data: { effectId: 'call1', effectType: 'CALL', error: { message: 'failed' }, lastKnownStatus: 'started', detectedAt: 3, finishedAt: 3 } } } };
      expect(activitySections([entry])[0]).toBe(entry);
    }
    expect(activitySections([{ ...item, entry: command(1) }])[0]?.kind).toBe('effect');
  });
  it('长任务只收起早期普通调用，保留最近六次调用之前的公开进度和当前推理', () => {
    const items = Array.from({ length: 8 }, (_, i) => [inference(i * 2), tool(i * 2 + 1)]).flat();
    const current = { ...inference(16), entry: { ...inference(16).entry, end: undefined } };
    const input = [...items, current];
    const window = activityWindow(input, false);
    expect(window.earlier.map(item => item.seq)).toEqual([0, 1, 2, 3]);
    expect(window.recent.map(item => item.seq)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect([...window.earlier, ...window.recent]).toEqual(input);
    expect(activityWindow(input.slice(0, 4), false).earlier).toHaveLength(0);
  });
  it('仅终态收敛整段，不删除任何记录；未加载开始事实不推断完成', () => {
    const items = [inference(1), tool(2)];
    expect(activityWindow(items, true)).toEqual({ earlier: items, recent: [] });
    expect(activityWindow(items, false)).toEqual({ earlier: [], recent: items });
  });
});


it('活动文件名优先且完整路径不丢失，目录/搜索图标使用准确语义', () => {
  const entry = (id: string, input: unknown): EffectEntry => ({
    ...command(0), end: undefined,
    effect: { type: 'CALL', target: { providerId: 'files', capabilityId: id, contractId: 'archer.tool@1', revision: 'v1' }, input },
  });
  const path = 'src/main/java/domain/model/LongFileName.java';
  expect(operationDisplay(entry('read', { path }))).toMatchObject({
    target: path, primary: 'LongFileName.java', directory: 'src/main/java/domain/model', icon: 'file',
  });
  expect(operationDisplay(entry('list', { path: '/project' })).icon).toBe('folder');
  expect(operationDisplay(entry('glob', { pattern: 'src/**/*.java' }))).toMatchObject({ primary: 'src/**/*.java', icon: 'search', directory: undefined });
  expect(operationDisplay(entry('shell', { command: 'cat /a/b' })).primary).toBe('cat /a/b');
});
