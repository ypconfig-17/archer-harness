import { useState, type ReactNode } from 'react';
import { Button } from '../primitives/Surface.js';
import { Icon } from '../primitives/Icon.js';
import { Spinner } from './Spinner.js';
import { CodeSnippet } from '../renderers/CodeSnippet.js';
import { InteractionCard } from './elements.js';
import { InteractionRecord } from './conversation.js';
import { Tool } from './Tool.js';
import {
  Trace,
  TraceLine,
  TraceIcon,
  TraceTitle,
  TraceDescription,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
} from './Trace.js';

export interface TaskStep {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  detail?: ReactNode;
}

/** 动态任务只展示已传入的步骤，与计划声明及全轮终态分离。 */
export function Task({
  title,
  steps,
  defaultOpen = false,
}: {
  title: string;
  steps: readonly TaskStep[];
  defaultOpen?: boolean;
}) {
  return (
    <Trace>
      <TraceCollapsible defaultOpen={defaultOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <Icon name="list" size="sm" />
            </TraceIcon>
            <TraceTitle>{title}</TraceTitle>
            <TraceDescription>{steps.length} 项活动</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent keepMounted>
          <Trace>
            {steps.map((step) => (
              <Tool
                key={step.id}
                title={step.title}
                status={step.status === 'completed' ? undefined : step.status}
                defaultOpen={step.status === 'running'}
                icon={
                  step.status === 'completed' ? (
                    <Icon name="check" size="sm" />
                  ) : step.status === 'error' ? (
                    <Icon name="alert" size="sm" />
                  ) : step.status === 'running' ? (
                    <Spinner label="运行中" />
                  ) : (
                    <Icon name="clock" size="sm" />
                  )
                }
              >
                {step.detail}
              </Tool>
            ))}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

/** 授权结果由宿主控制；点击按钮仅发出回调，不自行授予执行权限。 */
export function Confirmation({
  title,
  children,
  decision,
  busy = false,
  onApprove,
  onDeny,
}: {
  title: string;
  children: ReactNode;
  decision?: 'approved' | 'denied';
  busy?: boolean;
  onApprove(): void;
  onDeny(): void;
}) {
  if (decision)
    return (
      <InteractionRecord title={decision === 'approved' ? '已允许此操作' : '已拒绝此操作'}>
        <strong>{title}</strong>
        {children}
      </InteractionRecord>
    );
  return (
    <InteractionCard
      title={title}
      actions={
        <>
          <Button variant="secondary" disabled={busy} onClick={onDeny}>
            拒绝
          </Button>
          <Button variant="default" disabled={busy} onClick={onApprove}>
            {busy && <Spinner size="xs" />}
            {busy ? '正在提交…' : '允许此操作'}
          </Button>
        </>
      }
    >
      {children}
    </InteractionCard>
  );
}

/** 命令和输出均来自宿主；输出缺失不推断成功或失败，也不执行命令。 */
export function Terminal({
  command,
  output,
  status,
}: {
  command: string;
  output: string;
  status: 'pending' | 'running' | 'completed' | 'error' | 'unknown';
}) {
  const [open, setOpen] = useState<boolean>();
  const labels = {
    pending: '等待执行',
    running: '正在执行',
    completed: '已执行',
    error: '执行失败',
    unknown: '执行结果未知',
  };
  return (
    <Trace>
      <TraceCollapsible open={open ?? status === 'running'} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine
            status={
              status === 'running' || status === 'error' || status === 'pending'
                ? status
                : undefined
            }
          >
            <TraceIcon>
              {status === 'running' ? (
                <Spinner label="正在执行" />
              ) : (
                <Icon name="terminal" size="sm" />
              )}
            </TraceIcon>
            <TraceTitle title={command}>
              {labels[status]} · {command}
            </TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent keepMounted>
          <CodeSnippet title={command} text={output} />
          {!output && <p>暂无输出</p>}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
