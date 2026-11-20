import {
  useId,
  useState,
  type MouseEventHandler,
  type KeyboardEventHandler,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { Popover as Primitive } from '@base-ui/react/popover';
import { Button } from './Surface.js';

/** 自定义触发器通过 Base UI render 合并事件、引用与无障碍属性。 */
export interface PopoverTriggerProps {
  id: string;
  'aria-expanded': boolean;
  'aria-controls': string;
  'aria-haspopup': 'dialog';
}

/** 定位、避碰、外部关闭与焦点归还统一由 Base UI 维护。 */
export function Popover({
  label,
  trigger,
  children,
  className = '',
  role,
  contentRef,
  onOpenChange,
  onKeyDown,
  onClick,
}: {
  label: string;
  trigger?: (props: PopoverTriggerProps) => ReactNode;
  children: ReactNode;
  className?: string;
  role?: string;
  contentRef?: RefObject<HTMLDivElement | null>;
  onOpenChange?(open: boolean): void;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  onClick?: MouseEventHandler<HTMLDivElement>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const triggerProps: PopoverTriggerProps = {
    id: `${id}-trigger`,
    'aria-expanded': open,
    'aria-controls': id,
    'aria-haspopup': 'dialog',
  };
  return (
    <Primitive.Root open={open} onOpenChange={next => {
      setOpen(next);
      onOpenChange?.(next);
    }}>
      <Primitive.Trigger render={
        trigger ? trigger(triggerProps) as ReactElement : <Button variant="secondary">{label}</Button>
      } />
      <Primitive.Portal>
        <Primitive.Positioner sideOffset={8} align="start" collisionPadding={8} className="ui-popover-positioner">
          <Primitive.Popup
            ref={contentRef}
            id={id}
            role={role ?? 'dialog'}
            className={`ui-popover ${className}`.trim()}
            aria-label={label}
            onKeyDown={onKeyDown}
            onClick={onClick}
          >
            {children}
          </Primitive.Popup>
        </Primitive.Positioner>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
