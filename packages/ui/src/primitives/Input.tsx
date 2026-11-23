/** 结构与交互改编自 shadcn/ui Base UI 版本，来源和改动见包内 THIRD_PARTY.md。 */
import { Input as InputPrimitive } from '@base-ui/react/input';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';

/** 保留原生字段类型、表单约束与无障碍属性，不另维护输入状态。 */
export function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'cn-input w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
