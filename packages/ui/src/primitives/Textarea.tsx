import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';

/** 多行字段与单行输入共享表面、焦点环与错误状态；plain 只保留排版供输入容器复用。 */
export function Textarea({
  className,
  variant = 'default',
  ...props
}: ComponentProps<'textarea'> & { variant?: 'default' | 'plain' }) {
  return (
    <textarea
      data-slot="textarea"
      data-variant={variant}
      className={cn('cn-textarea w-full min-w-0 outline-none', className)}
      {...props}
    />
  );
}
