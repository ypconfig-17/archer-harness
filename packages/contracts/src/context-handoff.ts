/** 摘要交接的可序列化结构与来源校验；校验引用不等于证明文本推理正确。 */
import { z } from 'zod';
import type { Message } from './message.js';
const text = z.string().trim().min(1).max(2048);
const evidence = z.object({
  messageIndex: z.number().int().nonnegative(),
  quote: z.string().min(1).max(512).refine(value => Boolean(value.trim()), 'Empty evidence quote.'),
  toolOutcome: z.enum(['completed', 'tool-error']).optional(),
}).strict();
const claim = z.object({ text, evidence: z.array(evidence).min(1).max(8) }).strict();
export const ContextHandoffSchema = z.object({
  version: z.literal(2),
  findings: z.array(claim).max(32),
  hypotheses: z.array(text).max(16),
  rejectedApproaches: z.array(z.object({ approach: text, reason: text, evidence: z.array(evidence).min(1).max(8) }).strict()).max(16),
  decisions: z.array(z.object({ decision: text, preconditions: z.array(text).max(8), evidence: z.array(evidence).min(1).max(8) }).strict()).max(16),
  blockers: z.array(text).max(16),
  nextActions: z.array(z.object({
    action: text,
    preconditions: z.array(text).max(8),
    rereadEvidence: z.array(evidence).max(8),
  }).strict()).max(16),
}).strict().refine(value => value.findings.length + value.hypotheses.length + value.rejectedApproaches.length + value.decisions.length + value.blockers.length + value.nextActions.length > 0, 'Empty handoff.');
export type ContextHandoff = z.infer<typeof ContextHandoffSchema>;

/** 无可用交接是模型响应，不是允许丢弃历史的摘要。 */
export const NoContextHandoffSchema = z.object({
  version: z.literal(2), kind: z.literal('no-handoff'),
  reason: z.enum(['no-useful-information', 'insufficient-evidence']),
}).strict();
export class ContextHandoffUnavailable extends Error {
  constructor(readonly reason: z.infer<typeof NoContextHandoffSchema>['reason']) { super(`No usable handoff: ${reason}`); }
}

/** 索引固定到原始历史，不接受未来消息、伪造引文或与工具结果冲突的分类。 */
export function validateContextHandoff(content: string, source: readonly Message[]): ContextHandoff {
  if (content.length > 16_384) throw new Error('Handoff exceeds size limit.');
  const value: unknown = JSON.parse(content);
  const unavailable = NoContextHandoffSchema.safeParse(value);
  if (unavailable.success) throw new ContextHandoffUnavailable(unavailable.data.reason);
  const handoff = ContextHandoffSchema.parse(value);
  const references = contextHandoffEvidence(handoff);
  for (const ref of references) {
    const message = source[ref.messageIndex];
    if (!message || !message.content.includes(ref.quote)) throw new Error('Handoff evidence does not match source.');
    if (ref.toolOutcome && (message.role !== 'tool' || ref.toolOutcome !== (message.isError ? 'tool-error' : 'completed'))) throw new Error('Handoff tool outcome contradicts source.');
  }
  return handoff;
}

/** 所有需校验或统计的引文共用枚举规则，避免遗漏行动中的重读引用。 */
export function contextHandoffEvidence(handoff: ContextHandoff) {
  return [
    ...[...handoff.findings, ...handoff.rejectedApproaches, ...handoff.decisions].flatMap(item => item.evidence),
    ...handoff.nextActions.flatMap(item => item.rereadEvidence),
  ];
}
