import { Tooltip as Primitive } from '@base-ui/react/tooltip';
import type { ReactElement } from 'react';

/**
 * 提示只补充图标按钮的文字说明，不承载唯一信息或动作。
 * 触发器必须是无障碍名称完整的元素；这里只接管悬停与聚焦展示。
 */
export function Tooltip({
  label,
  children,
  side = 'top',
}: {
  label: string;
  children: ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <Primitive.Provider>
      <Primitive.Root>
        <Primitive.Trigger render={children} />
        <Primitive.Portal>
          <Primitive.Positioner side={side} sideOffset={6} className="ui-tooltip-positioner">
            <Primitive.Popup className="ui-tooltip">{label}</Primitive.Popup>
          </Primitive.Positioner>
        </Primitive.Portal>
      </Primitive.Root>
    </Primitive.Provider>
  );
}
