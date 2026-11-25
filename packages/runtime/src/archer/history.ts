/** 只从已提交状态快照提供模型可见结果，不暴露 Journal 或重执行入口。 */
import { HistoryReadInputSchema, HistoryListInputSchema, OperationRejected, type HistoryReader, type CallBatchResult, type CallResult, type CapabilityRef, type JsonValue, type JsonObject } from '@archer/contracts';
import type { SessionState } from '@archer/agent';
import type { ExecutionFact } from '@archer/handler';
function object(value: JsonValue | undefined): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}
export function committedHistory(state: SessionState): { history: HistoryReader; facts: ExecutionFact[] } {
  const pages = new Map<string, { content: string; isError: boolean } | null>();
  const facts: ExecutionFact[] = [];
  const calls: { turnId: string; callId: string; target: CapabilityRef; isError: boolean }[] = [];

  // 单条 CALL 与 CALL_BATCH 子项共用事实记录与可重读正文登记逻辑，保证并发工具输出同样可被裁剪与重读。
  const recordCall = (
    turnId: string,
    effectId: string,
    call: { target: CapabilityRef; toolCallId?: string; toolName?: string },
    status: ExecutionFact['status'],
    abandoned: boolean,
    result?: CallResult,
  ) => {
    const metadata = object(object(result?.value)?.metadata);
    const change = object(metadata?.fileChange);
    const command = object(metadata?.command);
    const fileChange = result && !result.isError && typeof change?.path === 'string' && typeof change.revisionAfter === 'string'
      ? { path: change.path, revisionAfter: change.revisionAfter,
        ...(change.revisionBefore === null || typeof change.revisionBefore === 'string' ? { revisionBefore: change.revisionBefore } : {}) } : undefined;
    facts.push({
      turnId,
      effectId,
      ...(call.toolCallId ? { callId: call.toolCallId } : {}),
      ...(call.toolName ? { toolName: call.toolName } : {}),
      status,
      abandoned,
      ...(fileChange ? { fileChange } : {}),
      ...(typeof command?.exitCode === 'number' && Number.isSafeInteger(command.exitCode) ? { command: { exitCode: command.exitCode } } : {}),
    });
    if (!result || !call.toolCallId) return;
    calls.push({ turnId, callId: call.toolCallId, target: call.target, isError: result.isError === true });
    const key = JSON.stringify([turnId, call.toolCallId]);
    const value = { content: result.modelContent ?? JSON.stringify(result.value), isError: result.isError === true };
    pages.set(key, pages.has(key) ? null : value);
  };

  for (const turn of state.turns.values()) for (const entry of turn.effects) {
    const baseStatus: ExecutionFact['status'] = entry.status === 'unknown' ? 'unknown'
      : entry.status === 'failed' ? 'failed'
        : entry.status === 'cancelled' ? 'cancelled' : 'pending';
    if (entry.effect.type === 'CALL') {
      const result = entry.status === 'completed' ? entry.result as CallResult | undefined : undefined;
      const status: ExecutionFact['status'] = entry.status === 'completed'
        ? (result?.isError ? 'business-error' : 'completed')
        : baseStatus;
      recordCall(turn.turnId, entry.effectId, entry.effect, status, Boolean(entry.abandoned), result);
      continue;
    }
    if (entry.effect.type === 'CALL_BATCH') {
      const batch = entry.status === 'completed' ? entry.result as CallBatchResult | undefined : undefined;
      entry.effect.calls.forEach((call, index) => {
        const item = batch?.results[index];
        if (entry.status === 'completed' && item?.status === 'completed') {
          const status: ExecutionFact['status'] = item.result.isError ? 'business-error' : 'completed';
          recordCall(turn.turnId, entry.effectId, call, status, Boolean(entry.abandoned), item.result);
          return;
        }
        const status: ExecutionFact['status'] = entry.status === 'completed' && item?.status === 'failed'
          ? 'failed'
          : baseStatus;
        recordCall(turn.turnId, entry.effectId, call, status, Boolean(entry.abandoned));
      });
    }
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
