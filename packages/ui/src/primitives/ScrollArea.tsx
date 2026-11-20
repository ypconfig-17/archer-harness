/** 改编自 shadcn/ui（revision e62c943），来源与本地改动见包内 THIRD_PARTY.md。 */
import { ScrollArea as Primitive } from '@base-ui/react/scroll-area';
import { cn } from '../lib/cn.js';

/**
 * 统一滚动容器：Base UI 负责视口、滚动条与拇指状态，业务只提供内容。
 * 高度由宿主的 flex / grid 约束决定，组件本身不写固定高度。
 */
export function ScrollArea({ className, children, viewportProps, ...props }: Primitive.Root.Props & {
  /** 阅读跟随需要真实视口引用，宿主不再另建滚动容器。 */
  viewportProps?: Primitive.Viewport.Props;
}) {
  return <Primitive.Root
    data-slot="scroll-area"
    className={cn('cn-scroll-area', className)}
    {...props}
  >
    <Primitive.Viewport
      {...viewportProps}
      data-slot="scroll-area-viewport"
      className={cn('cn-scroll-area-viewport', viewportProps?.className)}
    >
      {children}
    </Primitive.Viewport>
    <Primitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      className="cn-scroll-area-scrollbar"
      orientation="vertical"
    >
      <Primitive.Thumb data-slot="scroll-area-thumb" className="cn-scroll-area-thumb" />
    </Primitive.Scrollbar>
    <Primitive.Corner data-slot="scroll-area-corner" className="cn-scroll-area-corner" />
  </Primitive.Root>;
}
