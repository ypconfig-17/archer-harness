import type { KeyboardEventHandler } from 'react';
import { Button, Icon } from '@archer/ui';
import type { EffectEntry } from '../../lib/conversation';
import { durationText, operationDisplay, operationState } from '../../lib/operation';

/** 两处调用列表共享事实投影；会话只省略定位列，不另设状态或耗时规则。 */
export function InvocationRow({ entry, compact = false, selected, onSelect, onKeyDown, seq }: {
  entry: EffectEntry;
  compact?: boolean;
  selected?: boolean;
  onSelect?(): void;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
  seq?: number;
}) {
  const display = operationDisplay(entry);
  const state = operationState(entry);
  const duration = entry.end && 'durationMs' in entry.end.data ? entry.end.data.durationMs : undefined;
  const usage = entry.end?.type === 'effect.completed' && entry.end.data.effectType === 'INFER'
    ? entry.end.data.result.usage : undefined;
  const content = <>
    {!compact && <><time title={`记录 #${seq}`}>{new Date(entry.createdAt).toLocaleTimeString('zh-CN', { hour12: false })}</time>
      <span>{entry.effectType === 'INFER' ? '模型' : '工具'}</span></>}
    <span className="invocation-name">
      <Icon name={display.icon} size="sm" />
      <strong>{display.title}</strong>
      <small title={display.target} data-command={display.icon === 'terminal' ? 'true' : undefined}>{display.target}</small>
    </span>
    <span data-tone={state.tone}>{state.label}</span>
    {(!compact || duration !== undefined) && <span>{duration === undefined ? '—' : durationText(duration)}</span>}
    {!compact && <span>{usage ? `${usage.promptTokens.toLocaleString()} / ${usage.completionTokens.toLocaleString()}` : '—'}</span>}
  </>;
  // 两处点击均选择同一调用身份；未提供详情入口时保留普通文本。
  return onSelect
    ? <Button variant="ghost" className={`invocation-row${compact ? ' invocation-row-compact' : ''}`} aria-pressed={selected} onClick={onSelect} onKeyDown={onKeyDown}>{content}</Button>
    : <div className="invocation-row invocation-row-compact">{content}</div>;
}
