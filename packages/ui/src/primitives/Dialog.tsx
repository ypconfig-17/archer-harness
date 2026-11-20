import { useId, type ReactNode, type RefObject } from 'react';
import { Dialog as Primitive } from '@base-ui/react/dialog';
import { DialogHeader } from './Surface.js';

/** Base UI 维护焦点约束与归还，关闭请求由宿主确认后更新 open。 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  size = 'medium',
  closeDisabled = false,
  className = '',
  dismissOnBackdrop = false,
  initialFocus,
  children,
  actions,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: string;
  /** 尺寸只约束阅读宽度，不改变焦点和关闭语义。 */
  size?: 'small' | 'medium' | 'large';
  /** 保存或提交进行中可禁止关闭，但 Esc 仍交由宿主决定。 */
  closeDisabled?: boolean;
  /** 允许业务追加布局类，例如无内距的工作区弹窗。 */
  className?: string;
  /** 只有明确需要的流程才允许点击遮罩关闭。 */
  dismissOnBackdrop?: boolean;
  /** 需要强调安全选择时显式指定初始焦点，其余交给浏览器顺序。 */
  initialFocus?: RefObject<HTMLElement | null>;
  /** 只有说明与操作、没有正文的确认框可以省略内容。 */
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const id = useId();
  return (
    <Primitive.Root
      open={open}
      disablePointerDismissal={!dismissOnBackdrop || closeDisabled}
      onOpenChange={next => {
        // 提交期间拒绝用户关闭，避免界面消失后误判操作已经停止。
        if (!next && closeDisabled) return;
        onOpenChange(next);
      }}
    >
      <Primitive.Portal>
        <Primitive.Backdrop className="ui-dialog-backdrop" />
        <Primitive.Popup
          className={`ui-dialog ${className}`.trim()}
          data-size={size}
          aria-label={title}
          aria-describedby={description ? id : undefined}
          initialFocus={initialFocus}
        >
          <DialogHeader
            title={title}
            onClose={() => { if (!closeDisabled) onOpenChange(false); }}
            closeDisabled={closeDisabled}
          />
          {description && <Primitive.Description id={id}>{description}</Primitive.Description>}
          {children}
          {actions && <div className="ui-dialog-actions">{actions}</div>}
        </Primitive.Popup>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
