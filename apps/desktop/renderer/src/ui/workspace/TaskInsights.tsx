/** 对话仅保留变更入口，完整历史修改在右侧独立阅读。 */
import { createContext, useContext } from 'react';
import type { EffectEntry } from '../../lib/conversation';
import { taskChangeFiles } from '../../lib/task-insights';
import { FileChanges } from './FileChanges';

export const InspectChanges = createContext<((turnId: string, path?: string) => void) | undefined>(undefined);

export function TaskInsights({ entries, complete }: { entries: readonly EffectEntry[]; complete: boolean }) {
  const inspect = useContext(InspectChanges);
  const files = taskChangeFiles(entries);
  if (!files.length) return null;
  const turnId = entries[0].turnId;
  return <FileChanges
    files={files}
    note={complete ? '查看工具确认的任务修改，无需 Git' : '仅包含已加载记录中的修改'}
    onReview={inspect ? () => inspect(turnId) : undefined}
    onSelect={inspect ? path => inspect(turnId, path) : undefined}
  />;
}
