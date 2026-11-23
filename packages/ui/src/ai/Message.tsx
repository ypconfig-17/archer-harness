import type { ReactNode } from 'react';

/** 消息只组织公开内容，用户原文与模型公开反馈由宿主明确区分。 */
export function Message({
  role,
  children,
  header,
  actions,
}: {
  role: 'user' | 'assistant';
  children: ReactNode;
  header?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <article
      className="ui-message"
      data-role={role}
      aria-label={role === 'user' ? '用户消息' : 'Agent 消息'}
    >
      {header}
      <div className="ui-message-body">{children}</div>
      {actions && <footer className="ui-message-actions">{actions}</footer>}
    </article>
  );
}
