/** 仅在开发者显式开启时采集长度和时序；不包含正文，也不写入业务日志。 */
const previous = new Map<string, { time: number; content: number }>();

export function traceStream(
  stage: 'Renderer' | 'UI Commit',
  effectId: string,
  content: number,
  event: string,
  renderedChars?: number,
): void {
  try {
    if (localStorage.getItem('archer.streamDiagnostics') !== '1') return;
    const now = Date.now();
    const key = `${stage}:${effectId}`;
    const last = previous.get(key);
    if (previous.size >= 256 && !previous.has(key)) previous.delete(previous.keys().next().value!);
    previous.set(key, { time: now, content });
    console.info(JSON.stringify({
      diagnostic: 'archer.stream',
      stage,
      effectId,
      time: now,
      event,
      content,
      renderedChars,
      intervalMs: last ? now - last.time : null,
      deltaChars: last ? content - last.content : content,
    }));
  } catch {
    // 存储不可用或观察端异常不能打断正文展示。
  }
}
