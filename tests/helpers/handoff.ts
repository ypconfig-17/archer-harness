/** 合法 Markdown 交接 fixture，用于验证摘要边界、预算与连续继承。 */
import type { InferEffect, Message } from '@archer/contracts';

export function handoffFor(effect: InferEffect, text = 'Observed evidence; continue checking.') {
  const input = JSON.parse(effect.messages[1]!.content) as { sourceStart: number; messages: Message[] };
  const sample = input.messages.find(message => message.content.length > 0)?.content.slice(0, 32) ?? 'No textual snippet';
  return [
    '## Goal',
    'Continue the active task while preserving original user constraints.',
    '',
    '## Progress',
    `### Done`,
    `- [x] ${text} (ref: ${sample})`,
    '',
    '## Next Steps',
    '- Proceed with remaining verification.',
  ].join('\n');
}
