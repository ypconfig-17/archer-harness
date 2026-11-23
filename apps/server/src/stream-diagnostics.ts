/** 显式启用的进程观察；不接触正文、不写 AgentJournal，不影响执行与恢复。 */
import { channel } from 'node:diagnostics_channel';

if (process.env.ARCHER_STREAM_DIAGNOSTICS === '1') {
  const previous = new Map<string, { time: number; content: number }>();
  channel('archer.stream').subscribe(message => {
    const record = message as Record<string, unknown>;
    const key = `${record.stage}:${record.effectId ?? record.responseId}`;
    const now = Date.now();
    const last = previous.get(key);
    const content = typeof record.content === 'number' ? record.content : 0;
    // 诊断缓存有界；丢弃测量基线不会影响业务状态。
    if (previous.size >= 256 && !previous.has(key)) previous.delete(previous.keys().next().value!);
    previous.set(key, { time: now, content });
    console.error(JSON.stringify({ diagnostic: 'archer.stream', time: now, ...record,
      intervalMs: last ? now - last.time : null, deltaChars: last ? content - last.content : content }));
  });
}
