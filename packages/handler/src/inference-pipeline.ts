/** 推理流程：预算、准备、上下文整理、窗口准入、模型；提交异常越过能力错误归类。 */
import type { ContextPlan, InferEffect, InferResult } from '@archer/contracts';
import type { SessionEffectOutcome, SessionInferenceRequest } from '@archer/agent';
import { ExecutionCommitError, type HandlerContext } from './pipeline.js';
import { prepareInference } from './inference-preparation.js';
import { assertWindow } from './context-window.js';
import { manageContext } from './context-management.js';
import { usageAdmission } from './usage.js';
import { infer } from './infer.js';
import { abortedOutcome, elapsedMs, toErrorData } from './outcome.js';

export async function executeInference(effect: InferEffect, context: HandlerContext): Promise<SessionEffectOutcome | null> {
  if (context.signal.aborted) return abortedOutcome(context);
  const startedAt = context.now();
  const usage = [...context.inferenceHistory];
  const existing = context.effectRequests.find(request => request.purpose === 'agent' && request.status === 'completed');
  // 已提交模型结果但外层尚未收束时直接复用，不再次读取参考或调用模型。
  if (existing?.result) return { status: 'completed', result: existing.result, durationMs: elapsedMs(startedAt, context) };
  try {
    const admit = () => {
      const error = usageAdmission(usage, context.tokenBudget);
      if (error) throw Object.assign(new Error(error.message), error);
      if (context.signal.aborted) throw new Error('Inference was cancelled.');
    };
    const call = async (
      request: InferEffect,
      purpose: 'agent' | 'compaction',
      preparations?: InferResult['preparations'],
      plan?: ContextPlan,
    ): Promise<SessionInferenceRequest> => {
      admit();
      const window = assertWindow(request, context.inference);
      // 请求先经宿主提交再调用；摘要和普通推理共用同一预算账本。
      const record = await context.executeInference(request, purpose, async () => ({
        ...await infer(request, purpose === 'compaction' ? { ...context, onInferenceProgress: undefined } : context),
        ...(preparations ? { preparations } : {}),
        ...(window ? { contextWindow: window } : {}),
        ...(plan ? { contextPlan: plan } : {}),
      }));
      usage.push(record);
      return record;
    };
    admit();
    // 参考每次 INFER 只准备一次；摘要请求不运行项目准备或普通上下文链。
    const preparation = await prepareInference(effect, context);
    if (!preparation || context.signal.aborted) return abortedOutcome(context);
    const managed = await manageContext(effect, context, preparation.references, request => call(request, 'compaction'));
    const result = await call(managed.request, 'agent', preparation.preparations, managed.plan);
    return { status: 'completed', result: result.result!, durationMs: elapsedMs(startedAt, context) };
  } catch (error) {
    if (error instanceof ExecutionCommitError) throw error;
    if (context.signal.aborted) return abortedOutcome(context);
    return { status: 'failed', error: toErrorData(error), durationMs: elapsedMs(startedAt, context) };
  }
}
