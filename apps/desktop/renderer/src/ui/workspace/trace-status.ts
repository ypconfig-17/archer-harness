/** 操作状态到 Trace 行的唯一映射；事实标签仍由 operationState 提供。 */
export function traceStatus(tone: 'running' | 'ok' | 'error' | 'warning' | 'idle') {
  if (tone === 'running') return 'running' as const;
  if (tone === 'error') return 'error' as const;
  if (tone === 'warning') return 'warning' as const;
  if (tone === 'idle') return 'pending' as const;
  return undefined;
}

export function traceTone(tone: 'running' | 'ok' | 'error' | 'warning' | 'idle') {
  return tone === 'ok' || tone === 'warning' || tone === 'error' ? tone : undefined;
}
