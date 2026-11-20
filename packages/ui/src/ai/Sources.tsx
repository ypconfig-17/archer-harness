import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../primitives/Collapsible.js';
import { Children, type ReactNode } from 'react';
import { Icon } from '../primitives/Icon.js';
import { safeHttpUrl } from './url.js';

/**
 * 来源列表只展示宿主已经确认的引用。
 * 空列表不渲染空壳；组件不抓取 URL，也不推断来源是否可信。
 */
export function Sources({
  title = '来源',
  defaultOpen = false,
  children,
}: {
  title?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  // Children.count 会把条件渲染的 false 也算作一项；来源数量只统计真实条目。
  const count = Children.toArray(children).length;
  if (count === 0) return null;
  return (
    <Collapsible className="ui-sources" defaultOpen={defaultOpen}>
      <CollapsibleTrigger>
        <Icon name="link" size="sm" />
        <span>{title}</span>
        <small>{count}</small>
        <Icon name="chevron-right" size="sm" className="ui-disclosure-chevron" />
      </CollapsibleTrigger>
      <CollapsibleContent keepMounted>
        <ol>{children}</ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** 单条来源保留序号、标题、说明与原文地址；协议不受支持时只显示文字。 */
export function Source({
  index,
  title,
  href,
  description,
}: {
  index?: number;
  title: string;
  href: string;
  description?: string;
}) {
  const safeHref = safeHttpUrl(href);
  const content = (
    <>
      {index !== undefined && (
        <span className="ui-source-index" aria-hidden="true">
          {index}
        </span>
      )}
      <span className="ui-source-copy">
        <strong>{title}</strong>
        {description && <small>{description}</small>}
        <span className="ui-source-url">{href}</span>
      </span>
    </>
  );
  return (
    <li className="ui-source">
      {safeHref ? (
        <a href={safeHref} target="_blank" rel="noreferrer">
          {content}
        </a>
      ) : (
        <div>{content}</div>
      )}
    </li>
  );
}
