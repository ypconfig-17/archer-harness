import { inputText, type DisplayInput } from '../../lib/format';
import { Button, Icon } from '@archer/ui';

export function QueuePanel({
  paused,
  queued,
  steering,
  disabled,
  resumePending,
  clearPending,
  onResume,
  onClear
}: {
  paused: boolean;
  queued: readonly {
    readonly inputId: string;
    readonly input: DisplayInput;
  }[];
  steering: readonly {
    readonly inputId: string;
    readonly input: DisplayInput;
  }[];
  disabled: boolean;
  resumePending: boolean;
  clearPending: boolean;
  onResume(): void;
  onClear(): void;
}) {
  // 没有待处理输入时不占用输入区；暂停事实仍由会话状态保留。
  if (queued.length === 0 && steering.length === 0) return null;
  return <section className="input-queue" aria-label="输入队列">
    <header className="input-queue-header">
      <div className="input-queue-heading">
        <Icon name="list" size="sm" />
        <strong>输入队列</strong>
        <span className="input-queue-count">{queued.length + steering.length}</span>
        {paused && <span className="input-queue-status">已暂停</span>}
      </div>
      {queued.length > 0 && <div className="input-queue-actions">
        {paused && <Button variant="ghost" size="sm" className="input-queue-resume" onClick={onResume} disabled={disabled} aria-label="恢复队列">
          <Icon name="corner" size="sm" />
          {resumePending ? '恢复中…' : '恢复'}
        </Button>}
        <Button variant="ghost" size="sm" onClick={onClear} disabled={disabled} aria-label="清空队列">
          <Icon name="trash" size="sm" />
          {clearPending ? '清空中…' : '清空'}
        </Button>
      </div>}
    </header>
    <div className="input-queue-content" tabIndex={0} aria-label="待处理输入">
      {steering.length > 0 && <ul className="input-queue-list" aria-label="待应用引导">
        {steering.map(item => <li key={item.inputId}>
          <Icon name="corner" size="sm" />
          <div><span className="input-queue-kind">补充</span>{inputText(item.input)}</div>
        </li>)}
      </ul>}
      {queued.length > 0 && <ol className="input-queue-list" aria-label="排队任务">
        {queued.map((item, index) => <li key={item.inputId}>
          <span className="input-queue-order" aria-hidden="true">{index + 1}</span>
          <div>{inputText(item.input)}</div>
        </li>)}
      </ol>}
    </div>
  </section>;
}
