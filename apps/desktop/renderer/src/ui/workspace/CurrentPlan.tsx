import { RecordDisclosure } from '@archer/ui';
import { useMemo } from 'react';
import { buildItems, type TimelineEvent } from '../../lib/conversation';
import { taskPlan } from '../../lib/task-insights';
import { Icon } from '@archer/ui';

/** 只读取当前轮已提交声明，不从上一轮猜测计划继承。 */
export function CurrentPlan({ events, turnId }: { events: readonly TimelineEvent[]; turnId?: string }) {
  const plan = useMemo(() => taskPlan(buildItems(events).flatMap(item =>
    item.kind === 'effect' && item.turnId === turnId ? [item.entry] : [])), [events, turnId]);
  if (!turnId || !plan) return null;
  const completed = plan.steps.filter(step => step.status === 'completed').length;
  if (completed === plan.steps.length) return null;
  return <RecordDisclosure className="current-plan-dock" summary={<><Icon name="list" size="sm" /><span className="current-plan-label">当前计划</span><strong>{plan.title}</strong>
      <span>{completed}/{plan.steps.length} · 模型声明</span><Icon name="chevron-down" size="xs" /></>}>
    <ol>{plan.steps.map((step, index) => <li key={index} className={step.status === 'in_progress' ? 'is-current' : undefined}>
      <Icon name={step.status === 'completed' ? 'check' : step.status === 'in_progress' ? 'clock' : 'list'} size="xs" />
      <span>{step.text}</span>
    </li>)}</ol>
  </RecordDisclosure>;
}
