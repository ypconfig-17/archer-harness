/** 只从已提交状态快照提供模型可见结果，不暴露 Journal 或重执行入口。 */
import { HistoryReadInputSchema, HistoryListInputSchema, OperationRejected, type HistoryReader, type CallResult, type JsonValue, type JsonObject } from '@archer/contracts';
import type { SessionState } from '@archer/agent';
import type { ExecutionFact } from '@archer/handler';
function object(value: JsonValue | undefined): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}
export function committedHistory(state: SessionState): { history: HistoryReader; facts: ExecutionFact[] } {
  const pages = new Map<string, { content: string; isError: boolean } | null>();
  const facts: ExecutionFact[] = [];
  const calls: { turnId: string; callId: string; target: import('@archer/contracts').CapabilityRef; isError: boolean }[] = [];
  for (const turn of state.turns.values()) for (const entry of turn.effects) {
    if (entry.effect.type !== 'CALL') continue;
    const result = entry.status === 'completed' ? entry.result as CallResult | undefined : undefined;
    const metadata = object(object(result?.value)?.metadata);
    const change = object(metadata?.fileChange);
    const command = object(metadata?.command);
    const fileChange = result && !result.isError && typeof change?.path === 'string' && typeof change.revisionAfter === 'string'
      ? { path: change.path, revisionAfter: change.revisionAfter,
        ...(change.revisionBefore === null || typeof change.revisionBefore === 'string' ? { revisionBefore: change.revisionBefore } : {}) } : undefined;
    facts.push({ turnId: turn.turnId, effectId: entry.effectId,
      ...(entry.effect.toolCallId ? { callId: entry.effect.toolCallId } : {}),
      ...(entry.effect.toolName ? { toolName: entry.effect.toolName } : {}),
      status: entry.status === 'completed' ? result?.isError ? 'business-error' : 'completed'
        : entry.status === 'unknown' ? 'unknown' : entry.status === 'failed' ? 'failed'
          : entry.status === 'cancelled' ? 'cancelled' : 'pending', abandoned: Boolean(entry.abandoned),
      ...(fileChange ? { fileChange } : {}),
      ...(typeof command?.exitCode === 'number' && Number.isSafeInteger(command.exitCode) ? { command: { exitCode: command.exitCode } } : {}),
    });
    if (!result || !entry.effect.toolCallId) continue;
    calls.push({ turnId: turn.turnId, callId: entry.effect.toolCallId, target: entry.effect.target, isError: result.isError === true });
    const key = JSON.stringify([turn.turnId, entry.effect.toolCallId]);
    const value = { content: result.modelContent ?? JSON.stringify(result.value), isError: result.isError === true };
    pages.set(key, pages.has(key) ? null : value);
  }
  return { facts, history: {
    list(raw) {
      const input = HistoryListInputSchema.parse(raw);
      // 同名但来源版本不同的结果不能参与本次能力的状态校验。
      const selected = calls.filter(call => call.turnId === input.turnId
        && call.target.providerId === input.target.providerId
        && call.target.capabilityId === input.target.capabilityId
        && call.target.contractId === input.target.contractId
        && call.target.revision === input.target.revision);
      const offset = input.offset ?? 0;
      const end = Math.min(selected.length, offset + (input.limit ?? 128));
      return {
        calls: selected.slice(offset, end).map(({ callId, isError }) => ({ callId, isError })),
        ...(end < selected.length ? { nextOffset: end } : {}),
      };
    },
    read(raw) {
    const input = HistoryReadInputSchema.parse(raw);
    const candidates = [...pages.keys()].map(key => ({ key, ids: JSON.parse(key) as [string, string] }))
      .filter(item => item.ids[1] === input.callId && (input.turnId === undefined || item.ids[0] === input.turnId));
    if (candidates.length > 1) throw new OperationRejected(`Call ID occurs in multiple turns; specify turnId: ${JSON.stringify(candidates.slice(0, 8).map(item => item.ids[0]))}`, 'CONFLICT');
    const selected = candidates[0];
    const value = selected ? pages.get(selected.key) : undefined;
    if (value === null) throw new OperationRejected('Ambiguous historical call.', 'CONFLICT');
    if (!value) throw new OperationRejected('No committed visible result for this call.', 'NOT_FOUND');
    const offset = input.offset ?? 0;
    if (offset > value.content.length) throw new OperationRejected('History offset exceeds result length.', 'INVALID_INPUT');
    const splitsPair = (index: number) => index > 0 && index < value.content.length
      && value.content.charCodeAt(index - 1) >= 0xD800 && value.content.charCodeAt(index - 1) <= 0xDBFF
      && value.content.charCodeAt(index) >= 0xDC00 && value.content.charCodeAt(index) <= 0xDFFF;
    if (splitsPair(offset)) throw new OperationRejected('History offset splits a Unicode character.', 'INVALID_INPUT');
    let end = Math.min(value.content.length, offset + (input.limit ?? 4096));
    if (splitsPair(end)) end--;
    if (end === offset && offset < value.content.length) throw new OperationRejected('History limit cannot fit the next Unicode character.', 'INVALID_INPUT');
    return { turnId: selected!.ids[0], callId: input.callId, content: value.content.slice(offset, end), totalChars: value.content.length, offset,
      ...(end < value.content.length ? { nextOffset: end } : {}), isError: value.isError };
  } } };
}
