/** 覆盖历史连续性、未知结果和每轮上下文的真实来源。 */
import { describe, expect, it } from 'vitest';
import type { EffectEntry } from '../../../apps/desktop/renderer/src/lib/conversation';
import { taskChangeFiles, summarizeChangeFiles, taskChanges, taskPlan, inferenceContext } from '../../../apps/desktop/renderer/src/lib/task-insights';
import { planResult } from '../../../packages/providers/src/tools/plan';

function result(metadata: Record<string, unknown>): EffectEntry {
  return { effectId: 'e', turnId: 't', createdAt: 1, attempt: 1, effectType: 'CALL', end: {
    type: 'effect.completed', data: { effectId: 'e', effectType: 'CALL', result: { value: { metadata } }, durationMs: 1, finishedAt: 2 },
  } } as EffectEntry;
}
describe('任务洞察', () => {
  it('连续修改合并，不连续修改保留片段，不修改原始事实', () => {
    const first = result({ fileChange: { path: 'a', before: null, after: 'one' } });
    const changes = taskChanges([first, result({ fileChange: { path: 'a', before: 'one', after: 'two' } }), result({ fileChange: { path: 'a', before: 'external', after: 'three' } })]);
    expect(changes).toEqual([{ path: 'a', before: null, after: 'two' }, { path: 'a', before: 'external', after: 'three' }]);
    expect(taskChanges([first])[0]?.after).toBe('one');
  });
  it('文件构成区分新增、修改与未知原文，未知不补成修改', () => {
    const added = result({ fileChange: { path: '/src/new.ts', before: null, after: 'x' } });
    const modified = result({ fileChange: { path: '/src/edit.ts', before: 'a', after: 'b' } });
    const unknown = result({ fileChange: { path: '/src/unknown.ts', after: 'c' } });
    const revisionOnly = result({ fileChange: { path: '/src/rev.ts', after: 'd', revisionBefore: 'r1' } });
    const files = taskChangeFiles([added, modified, unknown, revisionOnly]);
    expect(files.map(file => [file.name, file.directory, file.kind])).toEqual([
      ['new.ts', '/src', 'added'],
      ['edit.ts', '/src', 'modified'],
      ['unknown.ts', '/src', 'unknown'],
      ['rev.ts', '/src', 'modified'],
    ]);
    expect(summarizeChangeFiles(files)).toEqual({ files: 4, modified: 2, added: 1, unknown: 1 });
  });

  it('同一文件的多个片段只占一行，状态取可确认性最高的一段', () => {
    // 先修改后创建说明文件在中途被替换，整条写入仍不能降级成普通修改。
    const files = taskChangeFiles([
      result({ fileChange: { path: '/src/A.ts', before: 'a', after: 'b' } }),
      result({ fileChange: { path: '/src/A.ts', before: null, after: 'c' } }),
      result({ fileChange: { path: '/src/A.ts', after: 'd' } }),
    ]);
    expect(files).toEqual([{ path: '/src/A.ts', name: 'A.ts', directory: '/src', kind: 'added' }]);
  });

  it('请求和未知结果不构成已应用修改或新计划', () => {
    const confirmed = result({ plan: { planId: 'work', title: '任务计划', revision: 1, steps: [{ text: '核对', status: 'in_progress' }] } });
    const pending = { ...confirmed, end: undefined };
    expect(taskPlan([confirmed, pending])?.steps[0]?.status).toBe('in_progress');
    expect(taskChanges([pending])).toEqual([]);
  });
  it('最近推理不沿用上次 token，累计消耗不冒充当前占用', () => {
    const entry: EffectEntry = { effectId: 'i', turnId: 't', attempt: 1, createdAt: 1, effect: { promptPrefixCount: 0, type: 'INFER', target: { providerId: 'inference', capabilityId: 'model', contractId: 'archer.inference@1', revision: 'test' }, messages: [{ role: 'system', content: 'instructions' }] } };
    expect(inferenceContext([entry])).toMatchObject({ effect: { messages: [{ content: 'instructions' }] }, usage: undefined });
  });
  it('计划节点拒绝多个进行中步骤和非法状态，无需工作区或私有状态', () => {
    expect(() => planResult({ action: 'create', planId: 'work', title: '任务计划', expectedRevision: null, steps: [{ text: 'a', status: 'in_progress' }, { text: 'b', status: 'in_progress' }] })).toThrow();
    expect(() => planResult({ action: 'create', planId: 'work', title: '任务计划', expectedRevision: null, steps: [{ text: 'a', status: 'unknown' }] })).toThrow();
    expect(planResult({ action: 'create', planId: 'work', title: '任务计划', expectedRevision: null, steps: [{ text: 'a', status: 'pending' }] })).toMatchObject({ metadata: { plan: { planId: 'work', title: '任务计划', revision: 1, steps: [{ text: 'a', status: 'pending' }] } } });
  });
});
