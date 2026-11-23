/** 合法交接 fixture 绑定实际摘要源快照，不伪造质量评测结论。 */
import type { InferEffect, Message } from '@archer/contracts';
export function handoffFor(effect: InferEffect, text = 'Observed evidence; continue checking.') {
  const input = JSON.parse(effect.messages[1]!.content) as { sourceStart: number; messages: Message[] };
  const index = input.messages.findIndex(message => message.content.length > 0);
  return JSON.stringify({ version: 2,
    findings: index < 0 ? [] : [{ text, evidence: [{ messageIndex: input.sourceStart + index, quote: input.messages[index]!.content.slice(0, 32) }] }],
    hypotheses: index < 0 ? ['Source contains no textual evidence.'] : [], rejectedApproaches: [], decisions: [], blockers: [], nextActions: [],
  });
}
