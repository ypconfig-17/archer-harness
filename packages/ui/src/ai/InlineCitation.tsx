import { Tooltip } from '../primitives/Tooltip.js';
import { safeHttpUrl } from './url.js';

/**
 * 行内引用只呈现编号与来源关系，不读取链接内容。
 * 非法协议保留编号与标题文字，但不再提供可点击入口。
 */
export function InlineCitation({
  index,
  title,
  href,
}: {
  index: number;
  title: string;
  href: string;
}) {
  const safeHref = safeHttpUrl(href);
  const label = `来源 ${index}：${title}`;
  const content = `[${index}]`;
  if (!safeHref) {
    return (
      <span className="ui-inline-citation" aria-label={label} title={title}>
        {content}
      </span>
    );
  }
  return (
    <Tooltip label={title}>
      <a
        className="ui-inline-citation"
        href={safeHref}
        target="_blank"
        rel="noreferrer"
        aria-label={label}
      >
        {content}
      </a>
    </Tooltip>
  );
}
