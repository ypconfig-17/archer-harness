import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../primitives/Collapsible.js';
import type { ReactNode } from 'react';
import { Icon } from '../primitives/Icon.js';
import { Spinner } from './Spinner.js';

/** 状态由宿主从事实投影；等待、停止请求和未知不能折叠成失败。 */
export type TurnStatus = 'running' | 'waiting-approval' | 'waiting-input' | 'stopping' | 'completed' | 'failed' | 'cancelled' | 'blocked';
const labels: Record<TurnStatus, string> = {
  running: '执行中',
  'waiting-approval': '等待授权',
  'waiting-input': '等待回答',
  stopping: '正在停止',
  completed: '已完成',
  failed: '执行失败',
  cancelled: '已停止',
  blocked: '执行受阻',
};

export function TurnSummary(props: {
  calls?: number;
  duration?: ReactNode;
  meta?: ReactNode;
  attention?: ReactNode;
  actions?: ReactNode;
  /** 供宿主说明摘要范围；不改变内部状态文案。 */
  ariaLabel?: string;
  /** 结束后的补充信息（用量、模型等），保持在摘要行下方。 */
  children?: ReactNode;
} & (
  | { status: TurnStatus; label?: never; tone?: never }
  | { label: ReactNode; tone?: 'running' | 'warning' | 'error' | 'muted'; status?: never }
)) {
  const { calls, duration, meta, attention, actions, children, ariaLabel } = props;
  const status = props.status;
  const tone = props.tone;
  return <footer className="archer-turn-summary" aria-label={ariaLabel} data-status={status} data-tone={tone}>
    <strong role="status">
      {status && (status === 'running' || status === 'stopping') && <Spinner size="xs" />}
      {/* 图标与状态文字共同表达结果，不依赖颜色；停止请求仍保留旋转反馈。 */}
      {status && status !== 'running' && status !== 'stopping' && <Icon
        name={status === 'completed' ? 'check' : status === 'cancelled' ? 'stop'
          : status === 'waiting-approval' ? 'shield' : status === 'waiting-input' ? 'info' : 'alert'}
        size="sm"
      />}
      {status ? labels[status] : props.label}
    </strong>
    {calls !== undefined && <span>{calls} 次调用</span>}
    {duration && <span>{duration}</span>}
    {meta && <span className="archer-turn-meta">{meta}</span>}
    {attention && <span className="archer-attention">{attention}</span>}
    {actions && <div>{actions}</div>}
    {children && <div className="archer-turn-summary-detail">{children}</div>}
  </footer>;
}

/** Markdown 由宿主成熟渲染器提供，操作插槽不内置剪贴板或文件权限。 */
export function AssistantAnswer({ children, actions, results }: {
  children: ReactNode;
  actions?: ReactNode;
  results?: ReactNode;
}) {
  return <section className="archer-assistant-answer" aria-label="最终答复">
    <div>{children}</div>
    {results && <div className="archer-answer-results">{results}</div>}
    {actions && <div className="archer-answer-actions">{actions}</div>}
  </section>;
}

export function InteractionRecord({ title, meta, icon, defaultOpen = false, children }: {
  title: ReactNode;
  meta?: ReactNode;
  icon?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return <Collapsible className="archer-interaction-record" defaultOpen={defaultOpen}>
    <CollapsibleTrigger>{icon}<span>{title}</span>{meta && <span className="archer-interaction-meta">{meta}</span>}
      <span className="ui-disclosure-chevron"><Icon name="chevron-right" size="xs" /></span></CollapsibleTrigger>
    <CollapsibleContent keepMounted>{children}</CollapsibleContent>
  </Collapsible>;
}

/** 未知、受阻与未确认提交分别表达，不能因视觉统一而自动重试。 */
export function ExecutionNotice({ kind, title, children, actions }: {
  kind: 'unknown' | 'blocked' | 'unconfirmed' | 'error';
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return <section className="archer-execution-notice" data-kind={kind} role={kind === 'error' ? 'alert' : 'status'}>
    <strong>{title}</strong><div>{children}</div>{actions && <footer>{actions}</footer>}
  </section>;
}
