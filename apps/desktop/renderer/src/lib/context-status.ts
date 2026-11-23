/** 从已提交请求与采用事实派生等待状态；不读取临时摘要文本或猜测完成百分比。 */
import type { EffectEntry } from './conversation';

export function contextStatus(entry: EffectEntry): {
  label: string;
  description: string;
  waiting: boolean;
  failed?: boolean;
} | undefined {
  const requests = entry.inferenceRequests ?? [];
  const current = requests.filter(request => request.attempt === undefined || request.attempt === entry.attempt);
  const compact = current.filter(request => request.purpose === 'compaction');
  const latest = compact.at(-1);
  if (!latest || entry.end || entry.abandonedReason) return undefined;
  const agent = current.find(request => request.purpose === 'agent');
  if (agent) {
    return requests.some(request => request.adopted)
      ? { label: '上下文已整理，正在继续任务…', description: '已采用交接摘要，正在继续推理。', waiting: false }
      : { label: '正在使用原始上下文继续任务…', description: '摘要未采用；本次请求也可能使用可读回的工具结果节选。', waiting: false };
  }
  if (latest.failed) {
    return { label: '上下文压缩请求失败', description: '正在等待任务结果确认。', waiting: false, failed: true };
  }
  if (latest.adopted) {
    return { label: '上下文已整理，正在继续任务…', description: '已采用交接摘要，正在准备后续请求。', waiting: false };
  }
  if (latest.result) {
    return { label: '正在核验上下文摘要…', description: '摘要已返回，正在检查是否可用；尚未确认采用。', waiting: true };
  }
  return {
    label: '正在压缩上下文…',
    description: '整理较早的对话与工具结果。历史摘要保留近期受保护内容和你的原始要求。',
    waiting: true,
  };
}
