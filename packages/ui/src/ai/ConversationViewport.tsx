import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollArea } from '../primitives/ScrollArea.js';
import { Button } from '../primitives/Surface.js';

/** 仅底部阅读跟随尺寸变化；向前加载历史时用高度差保留阅读位置。 */
export function ConversationViewport({ children, historyKey }: { children: ReactNode; historyKey?: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previous = useRef({ key: historyKey, height: 0 });
  const [away, setAway] = useState(false);
  useLayoutEffect(() => {
    const node = viewport.current;
    const body = content.current;
    if (!node || !body) return;
    const update = () => {
      const height = node.scrollHeight;
      if (following.current) node.scrollTop = height;
      else if (previous.current.key !== historyKey) node.scrollTop += height - previous.current.height;
      previous.current = { key: historyKey, height };
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(body);
    return () => observer.disconnect();
  }, [historyKey]);
  return <div className="archer-viewport-shell">
    <ScrollArea className="archer-conversation-scroll" viewportProps={{
      ref: viewport,
      className: 'archer-viewport',
      tabIndex: 0,
      'aria-label': '对话记录',
      onWheel: event => {
        if (event.deltaY < 0) following.current = false;
      },
      onScroll: event => {
        const node = event.currentTarget;
        const near = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
        following.current = near;
        setAway(!near);
      },
    }}>
      <div ref={content}>{children}</div>
    </ScrollArea>
    {away && <Button variant="secondary" className="archer-jump-latest" onClick={() => {
      following.current = true;
      if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
      setAway(false);
    }}>回到最新</Button>}
  </div>;
}

