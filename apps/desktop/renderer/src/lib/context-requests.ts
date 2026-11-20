import type { EffectEntry } from './conversation';
import type { inferenceContext } from './task-insights';

type ContextRequest = NonNullable<ReturnType<typeof inferenceContext>> & {
  key: string;
  turnId: string;
  effectId: string;
  requestId?: string;
  requestedAt?: number;
  summary?: string;
  compactedAt?: number;
  adopted?: boolean;
  failed?: boolean;
  responded?: boolean;
};

export type { ContextRequest };

/** 每个已提交请求独立展示；摘要请求与普通请求不能按同一 Effect 合并或覆盖。 */
export function contextRequests(entries: readonly EffectEntry[]): ContextRequest[] {
  return entries.flatMap<ContextRequest>(entry => {
    if (entry.effect?.type !== 'INFER') return [];
    const requests = entry.inferenceRequests ?? [];
    if (!requests.length) {
      return [{
        key: JSON.stringify([entry.turnId, entry.effectId, null]),
        turnId: entry.turnId,
        effectId: entry.effectId,
        requestId: undefined as string | undefined,
        effect: entry.effect,
        usage: undefined,
        preparations: undefined,
        reasoningLevel: entry.effect.config?.reasoning,
        purpose: undefined,
        sent: false,
        contextPlan: undefined,
      }];
    }
    return requests.map(request => ({
      key: JSON.stringify([entry.turnId, entry.effectId, request.requestId]),
      turnId: entry.turnId,
      effectId: entry.effectId,
      requestId: request.requestId,
      requestedAt: request.requestedAt,
      summary: request.summary,
      compactedAt: request.compactedAt,
      adopted: request.adopted,
      failed: request.failed,
      responded: request.result !== undefined,
      effect: request.request,
      usage: request.result?.usage,
      preparations: request.result?.preparations,
      reasoningLevel: request.result?.reasoningLevel ?? request.request.config?.reasoning,
      purpose: request.purpose,
      sent: true,
      contextPlan: request.result?.contextPlan,
    }));
  });
}
