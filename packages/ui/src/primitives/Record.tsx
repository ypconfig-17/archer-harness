import type { ComponentProps, ReactNode } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './Collapsible.js';
import { Button } from './Surface.js';

/** 设置与工作区共用记录表面；展开与键盘操作交给公共折叠原语。 */
export function RecordDisclosure({ summary, children, className = '', ...props }: Omit<ComponentProps<typeof Collapsible>, 'children'> & {
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <Collapsible {...props} className={`${className} ui-record-surface`.trim()}>
      <CollapsibleTrigger>{summary}</CollapsibleTrigger>
      <CollapsibleContent keepMounted>{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** 单行阅读入口复用公共按钮，业务只提供内容与动作。 */
export function RecordRow({ className = '', ...props }: ComponentProps<typeof Button>) {
  return <Button variant="ghost" {...props} className={`ui-record-action ${className}`.trim()} />;
}
