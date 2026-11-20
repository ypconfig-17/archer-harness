import type { EffectEntry } from '../../lib/conversation';
import { contextStatus } from '../../lib/context-status';
import { Icon } from '@archer/ui';

/**
 * 压缩只是当前执行阶段：用一行状态表达，不另起醒目的内容卡片。
 * 任务结束后不保留整理记录，逐请求的采用状态与估算在「上下文」页签阅读。
 */
export function ContextCompactionStatus({ entry, cancelling = false, paused = false }: {
  entry: EffectEntry;
  cancelling?: boolean;
  paused?: boolean;
}) {
  const status = contextStatus(entry);
  if (!status) return null;
  const waiting = status.waiting && !cancelling && !paused;
  const failed = status.failed && !cancelling && !paused;
  const label = cancelling ? '正在等待停止确认…' : paused ? '执行已暂停，等待处理' : status.label;
  const description = cancelling ? '已请求停止，尚未确认执行结束。'
    : paused ? '当前执行尚未收束，请查看会话状态。' : status.description;

  return (
    <div className={`context-compaction-status ${failed ? 'is-error' : ''}`} role="status" aria-live="polite" title={description}>
      {waiting ? <span className="execution-pulse" aria-hidden="true" /> : <Icon name={failed ? 'alert' : cancelling || paused ? 'clock' : 'info'} size="sm" />}
      <span>{label}</span>
    </div>
  );
}
