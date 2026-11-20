/** Journal Provider 独立实现提交协议，不通过 Agent CALL 记录自身。 */
import { provider, offer, JOURNAL } from '@archer/camp';
import { resolve, join } from 'node:path';
import { JsonlAgentJournal, MemoryAgentJournal } from './agent-journal.js';
export function journalProvider(directory: string) {
  const root = resolve(directory);
  return provider('journal', { agents: offer(JOURNAL, { description: '只追加的 Agent 执行日志。' }, new JsonlAgentJournal(join(root, 'agents'))) },
    { identity: { directory: root, format: 'provider-agent-jsonl' } });
}
export function memoryJournalProvider() {
  return provider('journal', { agents: offer(JOURNAL, { description: '仅驻留内存的 Agent 执行日志，不落盘。' }, new MemoryAgentJournal()) });
}
