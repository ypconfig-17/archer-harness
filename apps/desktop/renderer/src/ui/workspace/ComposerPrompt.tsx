import type { ComponentProps } from 'react';
import { useDraft } from '../../store/drafts';
import { PromptInputTextarea, PromptInputAttachment, PromptInputAttachments, PromptInputHeader, PromptInputSubmit, usePromptInputAttachments } from '@archer/ui';

/** 空附件不渲染表头，避免输入框上方留出无意义的间距。 */
export function ComposerAttachmentHeader() {
  const attachments = usePromptInputAttachments();
  if (!attachments.files.length) return null;
  return <PromptInputHeader>
    <PromptInputAttachments>{file => <PromptInputAttachment data={file} />}</PromptInputAttachments>
  </PromptInputHeader>;
}

/** 发送入口沿用输入区的圆形主操作，空文本且无附件时禁用。 */
export function ComposerSendButton({ busy, locked, draft, idleLabel = '发送', disabled = false, onStop, stopping = false }: {
  onStop?: () => void;
  stopping?: boolean;
  busy: boolean;
  locked: boolean;
  draft: string;
  idleLabel?: string;
  disabled?: boolean;
}) {
  const attachments = usePromptInputAttachments();
  // 结果未确认时发送键承担重试，不受当前草稿是否为空影响。
  const empty = !locked && !draft.trim() && !attachments.files.length;
  // 停止只提交取消请求，确认期间保持禁用，不能提前恢复成发送。
  if (onStop) return <PromptInputSubmit
    className="send-button"
    type="button"
    status={stopping ? 'submitted' : 'streaming'}
    disabled={stopping}
    aria-label={stopping ? '正在停止…' : '停止任务'}
    title={stopping ? '正在停止…' : '停止任务'}
    onClick={onStop}
  />;
  return <PromptInputSubmit
    className="send-button"
    status={busy ? 'submitted' : undefined}
    disabled={disabled || busy || empty}
    aria-label={busy ? '正在开始' : locked ? '重试发送' : idleLabel}
  />;
}

/** 草稿订阅限定在输入控件，逐字输入不触发会话历史、Markdown 与检查器重渲染。 */
export function DraftComposerTextarea({ draftKey, disabled }: {
  draftKey: string;
  disabled: boolean;
}) {
  const [draft, setDraft] = useDraft(draftKey);
  return <PromptInputTextarea
    aria-label="消息"
    placeholder="继续这段对话…"
    value={draft}
    disabled={disabled}
    onChange={event => setDraft(event.currentTarget.value)}
  />;
}

/** 发送键独立订阅同一草稿，保持空值判断即时更新且不扩大渲染范围。 */
export function DraftComposerSendButton({ draftKey, ...props }: Omit<ComponentProps<typeof ComposerSendButton>, 'draft'> & {
  draftKey: string;
}) {
  const [draft] = useDraft(draftKey);
  return <ComposerSendButton {...props} draft={draft} />;
}
