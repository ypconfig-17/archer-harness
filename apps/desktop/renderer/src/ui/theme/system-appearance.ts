import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-color-scheme: dark)';

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

/** 系统明暗只作为解析输入，不写入偏好；服务端渲染默认浅色。 */
export function useSystemDark(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
