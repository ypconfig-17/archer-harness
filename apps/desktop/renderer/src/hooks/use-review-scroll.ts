import { useLayoutEffect, useRef } from 'react';

/** 阅读位置只保存在当前面板内，按事实来源和路径隔离，不写入会话日志。 */
export function useReviewScroll(key: string, ready = true) {
  const ref = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, { top: number; left: number }>());
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !ready) return;
    const saved = positions.current.get(key);
    node.scrollTop = saved?.top ?? 0;
    node.scrollLeft = saved?.left ?? 0;
    // 异步代码高亮可能稍后撑开内容；恢复期间不把被截短的位置覆盖到缓存。
    let restoring = true;
    const restore = () => {
      if (restoring && saved) {
        node.scrollTop = saved.top;
        node.scrollLeft = saved.left;
      }
    };
    const observer = new ResizeObserver(restore);
    for (const child of node.children) observer.observe(child);
    const takeControl = () => { restoring = false; };
    const save = () => {
      if (!restoring) positions.current.set(key, { top: node.scrollTop, left: node.scrollLeft });
    };
    node.addEventListener('wheel', takeControl, { passive: true });
    node.addEventListener('pointerdown', takeControl);
    node.addEventListener('keydown', takeControl);
    node.addEventListener('scroll', save);
    return () => {
      save();
      observer.disconnect();
      node.removeEventListener('wheel', takeControl);
      node.removeEventListener('pointerdown', takeControl);
      node.removeEventListener('keydown', takeControl);
      node.removeEventListener('scroll', save);
    };
  }, [key, ready]);
  return ref;
}
