/** 事实参考来自提交状态，不能被模型摘要覆盖；有界投影明确声明遗漏数量。 */
import { OperationRejected, type Message } from '@archer/contracts';
import { executionReferenceContent } from './prompt/execution-reference.js';
export interface ExecutionFact {
  turnId: string; effectId: string; callId?: string; toolName?: string;
  status: 'pending' | 'completed' | 'business-error' | 'failed' | 'cancelled' | 'unknown';
  abandoned: boolean;
  fileChange?: { path: string; revisionAfter: string; revisionBefore?: string | null };
  command?: { exitCode: number };
}
export function executionReference(facts: readonly ExecutionFact[]): Message | undefined {
  if (!facts.length) return undefined;
  const unresolved = facts.filter(fact => fact.status === 'unknown' || fact.status === 'pending');
  const settled = facts.filter(fact => fact.status !== 'unknown' && fact.status !== 'pending');
  const bounded: ExecutionFact[] = [];
  let chars = 0;
  for (const fact of [...unresolved].reverse().concat([...settled].reverse())) {
    const size = JSON.stringify(fact).length;
    if (bounded.length < 32 && chars + size <= 8192) { bounded.push(fact); chars += size; }
  }
  const keptUnresolved = bounded.filter(fact => fact.status === 'unknown' || fact.status === 'pending').length;
  if (keptUnresolved < unresolved.length) throw new OperationRejected('Committed unresolved operations exceed the bounded reference capacity.', 'CONTEXT_BUDGET_EXCEEDED');
  return { role: 'user', content: executionReferenceContent({ records: bounded, omitted: facts.length - bounded.length, omittedUnresolved: unresolved.length - keptUnresolved }) };
}
