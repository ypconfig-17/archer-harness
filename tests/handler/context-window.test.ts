import { handoffFor } from '../helpers/handoff';
/** 窗口估算覆盖全部输入，原文保留调用配对与用户约束。 */
import { expect, it } from 'vitest';
import { defaultContextProfile } from '@archer/contracts';
import type { ContextProfile, ContextStep, InferEffect, Inference } from '@archer/contracts';
import { buildContext, assertWindow, measureUncoveredHistory, measureWindow, recentTargetTokens, selectContextStep, usageAdmission, ExecutionCommitError } from '@archer/handler';
import { executeInference } from '../../packages/handler/src/inference-pipeline.js';
import type { HandlerContext } from '@archer/handler';

const target = { providerId: 'model', capabilityId: 'infer', contractId: 'archer.inference@1', revision: 'v1' };

type CompactStep = Extract<ContextStep, { kind: 'compact' }>;
function compactStep(params: { reserveTokens: number; growthTokens?: number; keepRecentTokens?: number }): CompactStep {
  return {
    kind: 'compact', id: 'compact-1', enabled: true,
    params: {
      reserveTokens: params.reserveTokens,
      growthTokens: params.growthTokens ?? 100_000,
      keepRecentTokens: params.keepRecentTokens ?? 20_000,
      summaryBudgetTokens: 0,
    },
  };
}
function compactProfile(params: Parameters<typeof compactStep>[0], id = 'custom-test'): ContextProfile {
  return { version: 1, id, name: '测试配置', description: '', revision: 1, steps: [compactStep(params)] };
}
/** 全部步骤停用：用于确认窗口准入不依赖整理步骤是否启用。 */
const disabledProfile: ContextProfile = {
  version: 1, id: 'custom-disabled', name: '停用整理', description: '', revision: 1,
  steps: [{ ...compactStep({ reserveTokens: 0 }), enabled: false }],
};
const effect: InferEffect = { type: 'INFER', target, promptPrefixCount: 1, config: { contextProfile: defaultContextProfile() }, messages: [
  { role: 'system', content: 'Fixed policy.' }, { role: 'user', content: 'Keep all constraints.' },
  { role: 'assistant', content: '', toolCalls: [{ id: 'call', name: 'read', input: { path: 'file' }, signature: 'signed' }] },
  { role: 'tool', toolCallId: 'call', toolName: 'read', content: 'x'.repeat(16_000) },
] };
const inference: Inference = {
  measure: request => ({ contextWindow: 12_000, maxOutputTokens: 4096, estimatedInputTokens: JSON.stringify({ messages: request.messages, tools: request.tools }).length, method: 'test-bytes' }),
  infer: async () => ({ content: 'ok' }),
};
it('窗口充足时保留所有正文；超窗时拒绝而不截断工具结果', () => {
  const original = JSON.stringify(effect);
  const projected = buildContext(effect);
  expect(projected.messages).toEqual(effect.messages);
  expect(() => assertWindow(projected, inference)).toThrow('超过输入预算');
  expect(JSON.stringify(effect)).toBe(original);
});
it('触发线按完整输入和增长余量计算，缺少测量能力时不整理', () => {
  const profile = compactProfile({ reserveTokens: 16_384 });
  // 预留量实际不超过输入额度的 15%：88,000 × 0.15 = 13,200，所以容量线落在 74,800。
  const metrics = { estimatedInputTokens: 74_800, inputLimit: 88_000, historyMessages: 4 };
  expect(selectContextStep(profile, metrics)).toBeUndefined();
  expect(selectContextStep(profile, { ...metrics, estimatedInputTokens: 74_801 })).toMatchObject({ reason: 'capacity' });
  expect(selectContextStep(profile, { ...metrics, uncoveredTokens: 100_001 })).toMatchObject({ reason: 'growth' });
  // 同一快照上标记无收益的步骤不再重复选择。
  expect(selectContextStep(profile, metrics, new Set(['compact-1']))).toBeUndefined();
  // 模型不提供计量时没有窗口快照，整理链不会被评估。
  expect(measureWindow(effect, { infer: async () => ({ content: 'ok' }) })).toBeUndefined();
});
it('缺失与未知用量阻止预算准入；缓存不重复累加', () => {
  const record = { requestId: 'r1', attempt: 1, purpose: 'compaction' as const, request: effect, status: 'completed' as const, result: { content: 'summary', usage: { promptTokens: 90, completionTokens: 10, cacheReadTokens: 80 } } };
  expect(usageAdmission([record], 101)).toBeNull();
  expect(usageAdmission([record], 100)?.code).toBe('TOKEN_BUDGET_EXCEEDED');
  expect(usageAdmission([{ ...record, status: 'requested' }], 1000)?.code).toBe('TOKEN_USAGE_UNAVAILABLE');
  expect(usageAdmission([{ ...record, result: { content: 'summary' } }], 1000)?.code).toBe('TOKEN_USAGE_UNAVAILABLE');
});
it('提交确认异常越过推理失败归类，不返回伪造的 Provider 失败', async () => {
  const error = new ExecutionCommitError(new Error('unknown commit'));
  const context: HandlerContext = {
    agentId: 'a', turnId: 't', effectId: 'e', now: () => 0, signal: new AbortController().signal,
    inference: { infer: async () => ({ content: 'ok' }) }, prepare: async () => null,
    inferenceHistory: [], effectRequests: [], compactions: [], target: null, targetError: null, isStopping: () => false,
    executeInference: async () => { throw error; }, commitCompaction: async () => { throw error; },
  };
  await expect(executeInference(effect, context)).rejects.toBe(error);
});

function executionContext(model: Inference, requests: InferEffect[], adopted: string[]): HandlerContext {
  return {
    agentId: 'a', turnId: 't', effectId: 'e', now: () => 0, signal: new AbortController().signal,
    inference: model, prepare: async () => null, inferenceHistory: [], effectRequests: [], compactions: [], target: null, targetError: null, isStopping: () => false,
    executeInference: async (request, purpose, run) => {
      requests.push(request);
      return { requestId: `r${requests.length}`, attempt: 1, request, purpose, status: 'completed', result: await run() };
    },
    commitCompaction: async (requestId, coveredMessageCount) => {
      adopted.push(requestId);
      return { effectId: 'e', requestId, coveredMessageCount, summary: 'Confirmed summary.' };
    },
  };
}
it.each([undefined, { maxTokens: 6000, temperature: 0.2 }])('窗口预留不改写普通请求的显式或缺省输出配置 %j', async config => {
  const requests: InferEffect[] = [];
  const model: Inference = { ...inference, measure: request => ({ ...inference.measure!(request)!, contextWindow: 100_000, maxOutputTokens: 16_000 }), infer: async () => ({ content: 'Done.' }) };
  const outcome = await executeInference({ ...effect, config: { ...config, contextProfile: defaultContextProfile() } }, executionContext(model, requests, []));
  expect(outcome?.status).toBe('completed');
  expect(requests).toHaveLength(1);
  expect(requests[0]!.config).toEqual({ ...config, contextProfile: defaultContextProfile() });
  expect(outcome).toMatchObject({ result: { contextWindow: { outputReserve: config?.maxTokens ?? 16_000 } } });
});
it.each(['no-gain', 'invalid'] as const)('软阈值整理产生 %s 摘要时保留可容纳的原文，不采用且照实保留用量', async mode => {
  const requests: InferEffect[] = []; const adopted: string[] = [];
  const original: InferEffect = { type: 'INFER', target, promptPrefixCount: 0, config: { contextProfile: defaultContextProfile() }, messages: [{ role: 'assistant', content: 'Old' }, { role: 'user', content: 'x'.repeat(22_500) }] };
  const model: Inference = {
    measure: request => ({ contextWindow: 30_000, maxOutputTokens: 4096, estimatedInputTokens: JSON.stringify(request.messages).length, method: 'test-text' }),
    infer: async request => ({ content: request.messages[0]?.role === 'system' ? mode === 'invalid' ? '' : handoffFor(request) : 'Done.', usage: { promptTokens: 1, completionTokens: 1 } }),
  };
  const outcome = await executeInference(original, executionContext(model, requests, adopted));
  expect(outcome?.status).toBe('completed');
  expect(adopted).toEqual([]);
  expect(requests).toHaveLength(2);
  expect(requests[1]!.messages).toEqual(original.messages);
});
it('无收益摘要无法挽救超窗输入时不执行普通请求', async () => {
  const requests: InferEffect[] = []; const adopted: string[] = [];
  const original: InferEffect = { type: 'INFER', target, promptPrefixCount: 0, config: { contextProfile: defaultContextProfile() }, messages: [{ role: 'assistant', content: 'Old' }, { role: 'user', content: 'x'.repeat(25_400) }] };
  const model: Inference = {
    measure: request => ({ contextWindow: 30_000, maxOutputTokens: 4096, estimatedInputTokens: JSON.stringify(request.messages).length, method: 'test-text' }),
    infer: async request => ({ content: handoffFor(request), usage: { promptTokens: 1, completionTokens: 1 } }),
  };
  const outcome = await executeInference(original, executionContext(model, requests, adopted));
  expect(outcome).toMatchObject({ status: 'failed', error: { code: 'CONTEXT_COMPACTION_NO_GAIN' } });
  expect(adopted).toEqual([]);
  expect(requests).toHaveLength(1);
});

it('已知大窗口内多个旧工具结果也完整保留，不按年龄或共享额度截断', async () => {
  const messages: InferEffect['messages'] = [{ role: 'user', content: 'Keep exact evidence.' }];
  for (let index = 0; index < 8; index++) {
    messages.push({ role: 'assistant', content: '', toolCalls: [{ id: `c${index}`, name: 'read', input: { path: `${index}.ts` }, signature: 'signed' }] });
    messages.push({ role: 'tool', toolCallId: `c${index}`, toolName: 'read', content: `file-${index}:` + 'x'.repeat(5000) });
  }
  const source: InferEffect = { type: 'INFER', target, promptPrefixCount: 0, config: { contextProfile: defaultContextProfile() }, messages };
  const requests: InferEffect[] = [];
  const model: Inference = { ...inference, measure: request => ({ ...inference.measure!(request)!, contextWindow: 100_000, maxOutputTokens: 16_000 }), infer: async () => ({ content: 'Done.' }) };
  const outcome = await executeInference(source, executionContext(model, requests, []));
  expect(outcome?.status).toBe('completed');
  expect(requests).toHaveLength(1);
  expect(requests[0]!.messages).toEqual(messages);
  expect(requests[0]!.contextProjection).toMatchObject({ summarizedMessages: 0 });
});
it('放弃无收益摘要后仍按已花费用量检查预算，不能把回退当作免费', async () => {
  const requests: InferEffect[] = []; const adopted: string[] = [];
  const source: InferEffect = { type: 'INFER', target, promptPrefixCount: 0, config: { contextProfile: defaultContextProfile() }, messages: [{ role: 'assistant', content: 'Old' }, { role: 'user', content: 'x'.repeat(22_500) }] };
  const model: Inference = {
    measure: request => ({ contextWindow: 30_000, maxOutputTokens: 4096, estimatedInputTokens: JSON.stringify(request.messages).length, method: 'test-text' }),
    infer: async request => ({ content: handoffFor(request), usage: { promptTokens: 1, completionTokens: 1 } }),
  };
  const outcome = await executeInference(source, { ...executionContext(model, requests, adopted), tokenBudget: 2 });
  expect(outcome).toMatchObject({ status: 'failed', error: { code: 'TOKEN_BUDGET_EXCEEDED' } });
  expect(requests).toHaveLength(1); expect(adopted).toEqual([]);
});

it('任务策略控制触发余量和近期目标，关闭全部步骤仍拒绝超窗', async () => {
  const metrics = { estimatedInputTokens: 80_000, inputLimit: 88_000, historyMessages: 4 };
  expect(selectContextStep(compactProfile({ reserveTokens: 0 }), metrics)).toBeUndefined();
  expect(selectContextStep(compactProfile({ reserveTokens: 10_000 }), metrics)).toMatchObject({ reason: 'capacity' });
  expect(recentTargetTokens(compactStep({ reserveTokens: 0, keepRecentTokens: 5_000 }), { inputLimit: 16_000 })).toBe(4_000);
  expect(recentTargetTokens(compactStep({ reserveTokens: 0, keepRecentTokens: 1_000 }), { inputLimit: 400_000 })).toBe(1_000);
  const requests: InferEffect[] = [];
  const outcome = await executeInference({ ...effect, config: { contextProfile: disabledProfile } }, executionContext(inference, requests, []));
  expect(outcome).toMatchObject({ status: 'failed', error: { code: 'CONTEXT_BUDGET_EXCEEDED' } });
  expect(requests).toHaveLength(0);
});
it('未覆盖历史达到增长触发量时提前整理，不被大窗口容量线推迟', () => {
  const model: Inference = { ...inference, measure: request => ({ contextWindow: 1_000_000, maxOutputTokens: 100_000, estimatedInputTokens: JSON.stringify(request.messages).length, method: 'test-bytes' }) };
  const window = measureWindow(effect, model)!;
  const uncovered = measureUncoveredHistory(effect, model, 0)!;
  expect(uncovered).toBeGreaterThan(0);
  expect(measureUncoveredHistory(effect, model, 2)).toBeLessThan(uncovered);
  const metrics = { estimatedInputTokens: window.estimatedInputTokens, inputLimit: window.inputLimit, historyMessages: effect.messages.length - effect.promptPrefixCount };
  expect(selectContextStep(compactProfile({ reserveTokens: 0, growthTokens: uncovered }), { ...metrics, uncoveredTokens: uncovered })).toBeUndefined();
  expect(selectContextStep(compactProfile({ reserveTokens: 0, growthTokens: uncovered - 1 }), { ...metrics, uncoveredTokens: uncovered })).toMatchObject({ reason: 'growth' });
  // 缺少未覆盖历史估算时增长线不成立，只保留容量线。
  expect(selectContextStep(compactProfile({ reserveTokens: 0, growthTokens: 1 }), metrics)).toBeUndefined();
});
it('容量充足时增长触发仍生成并采用摘要，采用后未覆盖历史回落到触发量以下', async () => {
  const requests: InferEffect[] = []; const adopted: string[] = [];
  const source: InferEffect = { type: 'INFER', target, promptPrefixCount: 0, config: { contextProfile: compactProfile({ reserveTokens: 0, growthTokens: 1, keepRecentTokens: 1 }, 'custom-growth') }, messages: [
    { role: 'assistant', content: 'old evidence '.repeat(200) }, { role: 'user', content: 'Continue reviewing.' },
  ] };
  const model: Inference = {
    measure: request => ({ contextWindow: 1_000_000, maxOutputTokens: 100_000, estimatedInputTokens: JSON.stringify(request.messages).length, method: 'test-text' }),
    infer: async request => ({ content: request.messages[0]?.role === 'system' ? handoffFor(request) : 'Done.', usage: { promptTokens: 1, completionTokens: 1 } }),
  };
  const outcome = await executeInference(source, executionContext(model, requests, adopted));
  // 整理记录与普通结果一起提交，界面据此展示实际命中的快照与步骤。
  expect(outcome).toMatchObject({
    status: 'completed',
    result: {
      contextPlan: {
        profileId: 'custom-growth', profileName: '测试配置', profileRevision: 1,
        steps: [{ stepId: 'compact-1', kind: 'compact', reason: 'growth' }],
      },
    },
  });
  expect(adopted).toHaveLength(1);
  expect(requests).toHaveLength(2);
  expect(requests[1]!.messages[0]!).toMatchObject({ role: 'user' });
  expect(requests[1]!.messages[0]!.content).toContain('"version":2');
});
it('动态能力不支持计量时继续普通推理，不伪造窗口容量', async () => {
  const requests: InferEffect[] = [];
  const outcome = await executeInference(effect, executionContext({ infer: async () => ({ content: 'Done.' }), measure: () => undefined }, requests, []));
  expect(outcome?.status).toBe('completed');
  expect(requests).toHaveLength(1);
});

it('输出预留和安全余量超出整个窗口时，即使估算输入为零也拒绝', () => {
  const model: Inference = { ...inference, measure: () => ({ contextWindow: 256, maxOutputTokens: 128, estimatedInputTokens: 0, method: 'test' }) };
  expect(() => assertWindow(effect, model)).toThrow('输出预留与安全余量超过模型窗口');
});
it.each(['unavailable', 'method', 'window'] as const)('摘要后计量发生 %s 变化时不采用无法比较的收益', async change => {
  const requests: InferEffect[] = []; const adopted: string[] = [];
  let summarized = false;
  const source: InferEffect = { type: 'INFER', target, promptPrefixCount: 0, config: { contextProfile: defaultContextProfile() }, messages: [{ role: 'assistant', content: 'old evidence '.repeat(200) }, { role: 'user', content: 'x'.repeat(22_500) }] };
  const model: Inference = {
    measure: request => summarized && change === 'unavailable' ? undefined : ({
      contextWindow: summarized && change === 'window' ? 31_000 : 30_000, maxOutputTokens: 4096,
      estimatedInputTokens: JSON.stringify(request.messages).length,
      method: summarized && change === 'method' ? 'different' : 'test-text',
    }),
    infer: async request => { summarized = true; return { content: handoffFor(request), usage: { promptTokens: 1, completionTokens: 1 } }; },
  };
  const outcome = await executeInference(source, executionContext(model, requests, adopted));
  expect(outcome).toMatchObject({ status: 'failed', error: { code: 'CONTEXT_MEASUREMENT_CHANGED' } });
  expect(adopted).toEqual([]);
  expect(requests).toHaveLength(1);
});

it.each([22_500, 25_400])('无可用交接保留原文与用量，超窗则明确拒绝：输入 %s', async size => {
  const requests: InferEffect[] = []; const adopted: string[] = [];
  const original: InferEffect = { type: 'INFER', target, promptPrefixCount: 0, config: { contextProfile: defaultContextProfile() }, messages: [{ role: 'assistant', content: 'Old' }, { role: 'user', content: 'x'.repeat(size) }] };
  const model: Inference = {
    measure: request => ({ contextWindow: 30_000, maxOutputTokens: 4096, estimatedInputTokens: JSON.stringify(request.messages).length, method: 'test-text' }),
    infer: async request => ({ content: request.messages[0]?.role === 'system' ? JSON.stringify({ version: 2, kind: 'no-handoff', reason: 'no-useful-information' }) : 'Done.', usage: { promptTokens: 1, completionTokens: 1 } }),
  };
  const outcome = await executeInference(original, executionContext(model, requests, adopted));
  expect(adopted).toEqual([]);
  if (size === 22_500) {
    expect(outcome?.status).toBe('completed');
    expect(requests[1]!.messages).toEqual(original.messages);
    const limited: InferEffect[] = [];
    expect(await executeInference(original, { ...executionContext(model, limited, []), tokenBudget: 2 })).toMatchObject({ status: 'failed', error: { code: 'TOKEN_BUDGET_EXCEEDED' } });
    expect(limited).toHaveLength(1);
  } else {
    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'CONTEXT_COMPACTION_UNAVAILABLE' } });
    expect(requests).toHaveLength(1);
  }
});

it('缺失已提交策略快照时明确拒绝，不在执行时补默认配置', async () => {
  const requests: InferEffect[] = [];
  const outcome = await executeInference({ ...effect, config: undefined }, executionContext(inference, requests, []));
  expect(outcome).toMatchObject({ status: 'failed', error: { code: 'CONTEXT_PROFILE_REQUIRED' } });
  expect(requests).toEqual([]);
});

it.each(['no-plan', 'invalid', 'no-gain', 'limit', 'recovered-limit'] as const)('摘要 %s 时继续执行后续节选，摘要调用仍有界且照实记账', async mode => {
  const content = 'x'.repeat(12_000);
  const trim: ContextStep = {
    kind: 'trim-tool-results', id: 'trim', enabled: true, params: { minSavingsRatio: 0.25 },
  };
  const compact = compactStep({ reserveTokens: 0, keepRecentTokens: 1 });
  const compactCount = mode === 'limit' ? 7 : 1;
  const profile: ContextProfile = {
    version: 1, id: 'fallback', name: '摘要后节选', description: '', revision: 1,
    steps: [
      ...Array.from({ length: compactCount }, (_, index) => ({
        ...compact,
        id: `compact-${index}`,
        params: { ...compact.params, reasoning: (['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const)[index]! },
      })),
      trim,
    ],
  };
  const source: InferEffect = {
    type: 'INFER', target, promptPrefixCount: 0, config: { contextProfile: profile },
    messages: [
      ...(mode === 'no-plan' ? [] : [{ role: 'assistant' as const, content: 'Old' }]),
      { role: 'assistant', content: '', toolCalls: [{ id: 'call', name: 'source', input: {} }] },
      { role: 'tool', toolCallId: 'call', content },
    ],
    tools: [{ name: 'history_read', target: { ...target, providerId: 'history', capabilityId: 'read' }, description: 'History.', parameters: {} }],
  };
  const requests: InferEffect[] = [];
  const adopted: string[] = [];
  const model: Inference = {
    measure: request => ({ contextWindow: 10_000, maxOutputTokens: 1000, estimatedInputTokens: JSON.stringify(request.messages).length, method: 'chars' }),
    infer: async request => ({
      content: request.messages[0]?.role === 'system'
        ? mode === 'no-gain' ? handoffFor(request) : ''
        : 'Done.',
      usage: { promptTokens: 1, completionTokens: 1 },
    }),
  };
  const context: HandlerContext = {
    ...executionContext(model, requests, adopted),
    ...(mode === 'recovered-limit' ? { effectRequests: Array.from({ length: 4 }, (_, index) => ({
      requestId: `previous-${index}`, attempt: 1, purpose: 'compaction' as const,
      request: source, status: 'failed' as const, error: { code: 'PROVIDER_ERROR', message: 'Previous attempt failed.' },
    })) } : {}),
    history: { list: () => ({ calls: [] }), read: () => ({ turnId: 't', callId: 'call', content: 'xx', totalChars: content.length, offset: 0 }) },
  };
  const outcome = await executeInference(source, context);
  expect(outcome).toMatchObject({
    status: 'completed',
    result: { contextPlan: { steps: [{ stepId: 'trim', kind: 'trim-tool-results' }] } },
  });
  expect(adopted).toEqual([]);
  expect(requests).toHaveLength(mode === 'no-plan' || mode === 'recovered-limit' ? 1 : mode === 'limit' ? 5 : 2);
  expect(requests.at(-1)!.messages.at(-1)!.content).toContain('Tool output excerpt');
  // 无效摘要仍消耗预算；节选成功不能让后续普通推理绕过累计准入。
  if (mode === 'invalid') {
    expect(await executeInference(source, { ...context, tokenBudget: 2 })).toMatchObject({
      status: 'failed', error: { code: 'TOKEN_BUDGET_EXCEEDED' },
    });
  }
});
