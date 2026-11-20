import { useState, type ReactNode } from 'react';
import { Icon } from '../primitives/Icon.js';
import { Spinner } from './Spinner.js';
import {
  TraceLine,
  TraceIcon,
  TraceTitle,
  TraceDescription,
  TraceAction,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
} from './Trace.js';

/** 宿主提供事实文案与局部视觉状态；组件不把断流、审批或超时推断为失败。 */
export function Tool({
  title,
  description,
  status,
  children,
  icon,
  meta,
  defaultOpen = false,
  onSelect,
}: {
  title: string;
  description?: string;
  status?: 'running' | 'warning' | 'error' | 'pending';
  children?: ReactNode;
  icon?: ReactNode;
  /** 状态标签、授权标记等行尾信息，不参与展开逻辑。 */
  meta?: ReactNode;
  defaultOpen?: boolean;
  /** 提供后整行成为打开外部详情的入口，行内不再展开。 */
  onSelect?(): void;
}) {
  const line = (
    <TraceLine status={status}>
      <TraceIcon>
        {icon ??
          (status === 'running' ? (
            <Spinner label="运行中" />
          ) : (
            <Icon name="terminal" size="sm" />
          ))}
      </TraceIcon>
      <TraceTitle title={title}>{title}</TraceTitle>
      {description && <TraceDescription title={description}>{description}</TraceDescription>}
      {meta}
    </TraceLine>
  );
  if (onSelect) {
    return (
      <TraceAction
        onClick={onSelect}
        aria-label={description ? `${title} ${description}` : title}
      >
        {line}
        <TraceIcon className="ui-trace-chevron">
          <Icon name="chevron-right" size="sm" />
        </TraceIcon>
      </TraceAction>
    );
  }
  if (children === undefined || children === null) return line;
  return (
    <TraceCollapsible defaultOpen={defaultOpen}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent keepMounted>{children}</TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

/** 只接收已获准展示的文本；用户的展开选择优先于流式默认值。 */
export function Reasoning({ text, running = false }: { text: string; running?: boolean }) {
  const [open, setOpen] = useState<boolean>();
  const line = (
    <TraceLine status={running ? 'running' : undefined}>
      <TraceIcon>
        {running ? <Spinner label="正在思考" /> : <Icon name="spark" size="sm" />}
      </TraceIcon>
      <TraceTitle>{running ? '正在思考' : '思考记录'}</TraceTitle>
    </TraceLine>
  );
  if (!text) return line;
  return (
    <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent keepMounted>
        <p className="ui-reasoning-text">{text}</p>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
