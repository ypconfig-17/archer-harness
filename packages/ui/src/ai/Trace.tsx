/** 改编自 shadcn/ui Trace；仅调整语义样式与图标，不读取 Agent 事件。 */
import { Button } from "../primitives/Surface.js";
import * as React from "react";
import { Icon } from "../primitives/Icon.js";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../primitives/Collapsible.js";

const cn = (...values: (string | undefined)[]) =>
  values.filter(Boolean).join(" ");

/** 紧凑密度只改变阅读排版；默认密度保持调用方既有布局，不影响执行语义。 */
function Trace({
  className,
  density = "standard",
  ...props
}: React.ComponentProps<"div"> & { density?: "standard" | "compact" }) {
  return (
    <div
      data-slot="trace"
      data-density={density}
      className={cn("ui-trace", className)}
      {...props}
    />
  );
}

function TraceLine({
  className,
  status,
  ...props
}: React.ComponentProps<"span"> & {
  status?: "running" | "error" | "warning" | "pending";
}) {
  return (
    <span
      data-slot="trace-line"
      data-status={status}
      className={cn("ui-trace-line", className)}
      {...props}
    />
  );
}

function TraceIcon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="trace-icon"
      aria-hidden="true"
      className={cn("ui-trace-icon", className)}
      {...props}
    />
  );
}

function TraceTitle({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="trace-title"
      className={cn("ui-trace-title", className)}
      {...props}
    />
  );
}

function TraceDescription({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="trace-description"
      className={cn("ui-trace-description", className)}
      {...props}
    />
  );
}

function TraceCollapsible({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Collapsible>, "open" | "className"> & {
  className?: string;
} & (
    | { open?: undefined }
    | {
        open: boolean;
        onOpenChange: NonNullable<
          React.ComponentProps<typeof Collapsible>["onOpenChange"]
        >;
      }
  )) {
  return (
    <Collapsible
      data-slot="trace-collapsible"
      className={cn("ui-trace-collapsible", className)}
      {...props}
    />
  );
}

function TraceCollapsibleTrigger({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof CollapsibleTrigger>, "className"> & {
  className?: string;
}) {
  return (
    <CollapsibleTrigger
      data-slot="trace-collapsible-trigger"
      className={cn("ui-trace-collapsible-trigger", className)}
      {...props}
    >
      {children}
      <TraceIcon className="ui-trace-chevron">
        <Icon name="chevron-right" size="sm" />
      </TraceIcon>
    </CollapsibleTrigger>
  );
}

function TraceCollapsibleContent({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof CollapsibleContent>, "className"> & {
  className?: string;
}) {
  return (
    <CollapsibleContent
      data-slot="trace-collapsible-content"
      className="ui-trace-collapsible-content"
      {...props}
    >
      <div
        data-slot="trace-collapsible-content-inner"
        className={cn("ui-trace-collapsible-content-inner", className)}
      >
        {children}
      </div>
    </CollapsibleContent>
  );
}

/** 只读行入口用于打开外部详情；不展开内容，也不承诺查看后执行成功。 */
function TraceAction({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"button">, "type">) {
  return (
    <Button
      variant="ghost"
      data-slot="trace-action"
      className={cn("ui-trace-collapsible-trigger", "ui-trace-action", className)}
      {...props}
    >
      {children}
    </Button>
  );
}

export {
  Trace,
  TraceLine,
  TraceIcon,
  TraceTitle,
  TraceDescription,
  TraceAction,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
};
