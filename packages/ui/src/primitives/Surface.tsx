/** 按钮结构与变体改编自 shadcn/ui Base UI 版本，来源和改动见包内 THIRD_PARTY.md。 */
import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { useEffect, useId, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Icon } from './Icon.js';

const buttonVariants = cva(
  "cn-button group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: 'cn-button-variant-default',
        outline: 'cn-button-variant-outline',
        secondary: 'cn-button-variant-secondary',
        ghost: 'cn-button-variant-ghost',
        destructive: 'cn-button-variant-destructive',
        'destructive-solid': 'cn-button-variant-destructive-solid',
        link: 'cn-button-variant-link',
      },
      size: {
        default: 'cn-button-size-default',
        xs: 'cn-button-size-xs',
        sm: 'cn-button-size-sm',
        lg: 'cn-button-size-lg',
        icon: 'cn-button-size-icon',
        'icon-xs': 'cn-button-size-icon-xs',
        'icon-sm': 'cn-button-size-icon-sm',
        'icon-lg': 'cn-button-size-icon-lg',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

/** 本地补充 type 默认值：桌面表单工具条里的按钮不应隐式提交。 */
export function Button({
  className,
  variant = 'default',
  size = 'default',
  type = 'button',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      type={type}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

/** 非模态浮层共享表面样式；定位与展开状态仍由入口管理。 */
export function FloatingSurface({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`ui-floating-surface ${className}`} />;
}

/** 浮层标题保持一致的阅读起点；关闭策略由业务决定，保存中可禁止退出。 */
export function DialogHeader({ title, description, onClose, closeDisabled = false }: {
  title: string;
  description?: ReactNode;
  onClose(): void;
  closeDisabled?: boolean;
}) {
  return (
    <header className="ui-dialog-header">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      <button
        type="button"
        className="ui-close"
        aria-label={`关闭${title}`}
        disabled={closeDisabled}
        onClick={onClose}
      >
        <Icon name="x" />
      </button>
    </header>
  );
}

/** 操作区与字段只定义结构；提交、关闭和保存中的约束由业务维护。 */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="ui-dialog-actions">{children}</div>;
}

export function FormField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="ui-field"><span>{label}</span>{children}</label>;
}

/** 确认框默认聚焦取消；Esc 只关闭当前确认，不触发父设置窗口的退出流程。 */
export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onClose }: {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm(): void;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    node?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => node?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="ui-dialog"
      data-size="medium"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={event => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <h2 id={`${id}-title`}>{title}</h2>
      <p id={`${id}-description`} className="ui-confirm-copy">{description}</p>
      <DialogActions>
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button variant="destructive-solid" onClick={onConfirm}>{confirmLabel}</Button>
      </DialogActions>
    </dialog>
  );
}
