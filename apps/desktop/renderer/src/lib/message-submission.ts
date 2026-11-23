import type { Submission } from '../store/submissions';

/** 仅投影发送方式；停止确认期间不能再向原任务追加引导。 */
export function messageMode(
  active: boolean,
  cancelling: boolean,
  queued: number,
  preferred: Submission['mode'],
): Submission['mode'] {
  if (active) return !cancelling && preferred === 'steer' ? 'steer' : 'followUp';
  return queued > 0 ? 'followUp' : 'send';
}

/**
 * 新任务先准备授权、再恢复空队列；任一步失败都不发送。
 * 未确认请求只重放原提交，避免重试时解除后来提交的暂停或改写授权。
 * 服务端仍负责串行准入与 requestId 幂等，页面不推断任务是否执行。
 */
export async function submitMessage(request: Submission, options: {
  retry: boolean;
  paused: boolean;
  prepareAuthorization(): Promise<void>;
  resumeQueue(): Promise<unknown>;
  remember(): void;
  send(request: Submission): Promise<unknown>;
  steer(request: Submission): Promise<unknown>;
  followUp(request: Submission): Promise<unknown>;
}) {
  if (request.mode === 'send' && !options.retry) {
    await options.prepareAuthorization();
    if (options.paused) await options.resumeQueue();
  }
  options.remember();
  await options[request.mode](request);
}
