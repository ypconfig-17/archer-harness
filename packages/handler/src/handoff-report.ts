/** 从已提交请求投影引用开销；只报告机械指标，不给出语义质量分数。 */
import { ContextHandoffUnavailable, contextHandoffEvidence, validateContextHandoff, type ContextHandoff } from '@archer/contracts';
import type { SessionState } from '@archer/agent';
export function handoffReport(state: Pick<SessionState, 'turns' | 'compactions'>) {
  const adopted = new Set(state.compactions.map(item => item.requestId));
  const records = [];
  const measurements = [];
  for (const turn of state.turns.values()) for (const effect of turn.effects) {
    if (effect.effect.type !== 'INFER') continue;
    for (const request of effect.inferenceRequests) {
      const window = request.result?.contextWindow;
      const usage = request.result?.usage;
      if (window) {
        measurements.push({
          turnId: turn.turnId,
          requestId: request.requestId,
          purpose: request.purpose,
          target: request.request.target,
          config: request.request.config,
          method: window.method,
          estimatedInputTokens: window.estimatedInputTokens,
          ...(usage ? {
            promptTokens: usage.promptTokens,
            estimateToActualRatio: usage.promptTokens > 0 ? window.estimatedInputTokens / usage.promptTokens : null,
          } : {}),
        });
      }
      if (request.purpose !== 'compaction') continue;
      let disposition = request.status === 'completed' ? 'invalid' : request.status;
      let metrics: { responseChars: number; quoteChars: number; uniqueQuoteChars: number; evidenceJsonChars: number; evidenceReferences: number; quoteCharShare: number } | undefined;
      if (request.result) {
        try {
          const payload = JSON.parse(request.request.messages[1]!.content) as { sourceStart: number; messages: unknown[] };
          const covered = payload.sourceStart + payload.messages.length;
          if (!Number.isSafeInteger(covered) || covered < 0 || covered > effect.effect.messages.length - effect.effect.promptPrefixCount) throw new Error('Invalid source range.');
          if (request.result.stopReason === 'length' || request.result.stopReason === 'toolUse' || request.result.toolCalls?.length) throw new Error('Incomplete response.');
          const handoff = validateContextHandoff(request.result.content, effect.effect.messages.slice(effect.effect.promptPrefixCount, effect.effect.promptPrefixCount + covered));
          metrics = measureHandoffEvidence(handoff, request.result.content);
          disposition = adopted.has(request.requestId) ? 'adopted' : 'not-adopted';
        } catch (error) {
          if (error instanceof ContextHandoffUnavailable) disposition = 'no-handoff';
        }
      }
      records.push({ turnId: turn.turnId, requestId: request.requestId, disposition,
        ...(metrics ? { metrics } : {}), ...(request.result?.usage ? { usage: request.result.usage } : {}) });
    }
  }
  return { measurements, semanticQuality: 'not-measured' as const, characterUnit: 'UTF-16' as const,
    requests: records.length, adopted: records.filter(record => record.disposition === 'adopted').length,
    requestsWithoutUsage: records.filter(record => !record.usage).length,
    reportedTokens: records.reduce((sum, record) => sum + (record.usage ? record.usage.promptTokens + record.usage.completionTokens : 0), 0), records };
}

/** 字符统计包含重复引文；不将字符占比误称为 token 占比。 */
export function measureHandoffEvidence(handoff: ContextHandoff, content: string) {
  const refs = contextHandoffEvidence(handoff);
  const quoteChars = refs.reduce((sum, ref) => sum + ref.quote.length, 0);
  return { responseChars: content.length, quoteChars,
    uniqueQuoteChars: [...new Set(refs.map(ref => ref.quote))].reduce((sum, quote) => sum + quote.length, 0),
    evidenceJsonChars: refs.reduce((sum, ref) => sum + JSON.stringify(ref).length, 0),
    evidenceReferences: refs.length, quoteCharShare: content.length ? quoteChars / content.length : 0 };
}
