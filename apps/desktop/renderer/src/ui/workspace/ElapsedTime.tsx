import { useEffect, useState } from 'react';
import { durationText } from '../../lib/operation';

/** 计时只更新自身文本；不向父级发布状态，也不重建历史投影。 */
export function ElapsedTime({ startedAt, endedAt, durationMs, displayTime, running }: {
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  displayTime?: number;
  running: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    // 已结束、固定预览和缺失起点都不订阅时钟，不能从当前时间补造事实耗时。
    if (!running || startedAt === undefined || endedAt !== undefined || durationMs !== undefined || displayTime !== undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, startedAt, endedAt, durationMs, displayTime]);
  const duration = durationMs ?? (startedAt === undefined ? undefined : Math.max(0, (endedAt ?? displayTime ?? now) - startedAt));
  return duration === undefined ? null : <>{durationText(duration)}</>;
}
