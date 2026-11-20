import type { ComponentProps, ReactNode } from 'react';
import { Button } from '../primitives/Surface.js';

/** 快捷建议只收拢宿主提供的文案，不自动提交，也不推测用户意图。 */
export function Suggestions({
  label = '快捷建议',
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className="ui-suggestions" role="group" aria-label={label}>
      {children}
    </div>
  );
}

/** 点击只触发宿主回调；禁用状态由宿主的业务条件决定。 */
export function Suggestion({ className = '', ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      variant={props.variant ?? 'secondary'}
      className={`ui-suggestion ${className}`.trim()}
    />
  );
}
