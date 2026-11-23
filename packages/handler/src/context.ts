/** 只读取显式历史与已提交摘要，用户消息和原始事实保持完整。 */
import type { InferEffect, Message } from '@archer/contracts';
import type { SessionCompaction } from '@archer/agent';
import { summaryReference } from './prompt/compaction.js';

export function buildContext(effect: InferEffect, summary?: SessionCompaction): InferEffect {
  const prefix = effect.messages.slice(0, effect.promptPrefixCount);
  const history = effect.messages.slice(effect.promptPrefixCount);
  if (summary && summary.coveredMessageCount > history.length) throw new Error('Summary exceeds the fixed history snapshot.');
  // 已覆盖范围仍保留所有用户与系统消息；只整组替换较早助手和工具交互。
  const retained: Message[] = summary
    ? [...history.slice(0, summary.coveredMessageCount).filter(message => message.role === 'user' || message.role === 'system'), ...history.slice(summary.coveredMessageCount)]
    : history;
  const references: Message[] = summary ? [{ role: 'user', content: summaryReference(summary.summary, summary.coveredMessageCount) }] : [];
  return {
    ...effect,
    messages: [...prefix, ...references, ...retained],
    promptPrefixCount: prefix.length + references.length,
    contextProjection: {
      originalChars: JSON.stringify(history).length,
      projectedChars: JSON.stringify([...references, ...retained]).length,
      summarizedMessages: history.length - retained.length,
    },
  };
}
