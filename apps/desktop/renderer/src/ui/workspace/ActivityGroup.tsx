import { memo, type ReactNode } from 'react';
import type { EffectEntry } from '../../lib/conversation';
import { operationCategory, operationState } from '../../lib/operation';
import { Icon, ActivityGroup as UIActivityGroup, Trace, ScrollArea } from '@archer/ui';
import { InvocationRow } from './InvocationRow';

/** 连续调用组保留事实顺序，异常与当前执行不被历史折叠吞掉。 */
export const ActivityGroup = memo(function ActivityGroup({ entries, onInspect }: { entries: EffectEntry[]; onInspect?(effectId: string): void }) {
  const row = (entry: EffectEntry) => <InvocationRow key={entry.effectId} entry={entry} compact onSelect={onInspect ? () => onInspect(entry.effectId) : undefined} />;
  const nodes: ReactNode[] = [];
  let folded: EffectEntry[] = [];
  const flush = () => {
    if (!folded.length) return;
    const group = folded;
    folded = [];
    // 分类计数只由已提交调用投影，帮助扫读；它不证明整轮完成或计划阶段。
    const counts = { read: 0, write: 0, command: 0, other: 0 };
    for (const entry of group) counts[operationCategory(entry)]++;
    const breakdown = [
      counts.read > 0 ? `读取 ${counts.read} 次` : '',
      counts.write > 0 ? `修改 ${counts.write} 次` : '',
      counts.command > 0 ? `执行 ${counts.command} 次` : '',
      counts.other > 0 ? `其他 ${counts.other} 次` : '',
    ].filter(Boolean).join(' · ');
    // 连续已结束调用折叠为一行；失败、未知与运行中调用留在原位，不被这一行吞并。
    nodes.push(
      <Trace density="compact" key={`fold-${group[0]!.effectId}`}>
        <UIActivityGroup title={`工具活动 · ${group.length} 次调用`} meta={breakdown}
          icon={<Icon name="terminal" size="sm" />}>
          <ScrollArea className="conversation-tool-scroll" aria-label="工具调用列表">
            {group.map(row)}
          </ScrollArea>
        </UIActivityGroup>
      </Trace>
    );
  };
  for (const entry of entries) {
    const visible = !entry.end || ['error', 'warning'].includes(operationState(entry).tone);
    if (visible) { flush(); nodes.push(row(entry)); } else folded.push(entry);
  }
  flush();
  return <div className="conversation-tool-group" aria-label="工具活动">{nodes}</div>;
});
