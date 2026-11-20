import { describe, expect, it, vi } from 'vitest';
import { messageMode, submitMessage } from '../../../apps/desktop/renderer/src/lib/message-submission';
import type { Submission } from '../../../apps/desktop/renderer/src/store/submissions';

const request: Submission = {
  mode: 'send',
  input: '继续任务',
  requestId: 'original-request',
  allowShell: true,
  commandMode: 'ask',
};

function ports(overrides = {}) {
  return {
    retry: false,
    paused: true,
    prepareAuthorization: vi.fn().mockResolvedValue(undefined),
    resumeQueue: vi.fn().mockResolvedValue(undefined),
    remember: vi.fn(),
    send: vi.fn().mockResolvedValue(undefined),
    steer: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('停止后的发送与队列', () => {
  it('停止确认期间不再补充当前任务；结束后有积压则继续排队', () => {
    expect(messageMode(true, false, 0, 'steer')).toBe('steer');
    expect(messageMode(true, true, 0, 'steer')).toBe('followUp');
    expect(messageMode(false, false, 1, 'steer')).toBe('followUp');
    expect(messageMode(false, false, 0, 'steer')).toBe('send');
  });

  it('空暂停队列的新发送先准备授权，再恢复，最后发送', async () => {
    const order: string[] = [];
    const options = ports({
      prepareAuthorization: async () => { order.push('authorization'); },
      resumeQueue: async () => { order.push('resume'); },
      remember: () => { order.push('remember'); },
      send: async () => { order.push('send'); },
    });
    await submitMessage(request, options);
    expect(order).toEqual(['authorization', 'resume', 'remember', 'send']);
  });

  it.each(['prepareAuthorization', 'resumeQueue'] as const)('%s 失败时不发送，不保留尚未发送的请求', async step => {
    const options = ports();
    options[step].mockRejectedValue(new Error('未确认'));
    await expect(submitMessage(request, options)).rejects.toThrow('未确认');
    expect(options.send).not.toHaveBeenCalled();
    expect(options.remember).not.toHaveBeenCalled();
    if (step === 'prepareAuthorization') expect(options.resumeQueue).not.toHaveBeenCalled();
  });

  it('发送结果未知后重试原请求，不解除后来提交的暂停，也不修改授权', async () => {
    const options = ports();
    options.send.mockRejectedValueOnce(new Error('连接中断'));
    await expect(submitMessage(request, options)).rejects.toThrow('连接中断');
    vi.clearAllMocks();
    await submitMessage(request, { ...options, retry: true });
    expect(options.prepareAuthorization).not.toHaveBeenCalled();
    expect(options.resumeQueue).not.toHaveBeenCalled();
    expect(options.send).toHaveBeenCalledExactlyOnceWith(request);
  });

  it('向暂停队列追加输入仅排队，不恢复旧任务或改变授权', async () => {
    const options = ports();
    const queued = { ...request, mode: 'followUp' as const, allowShell: false };
    await submitMessage(queued, options);
    expect(options.followUp).toHaveBeenCalledExactlyOnceWith(queued);
    expect(options.send).not.toHaveBeenCalled();
    expect(options.prepareAuthorization).not.toHaveBeenCalled();
    expect(options.resumeQueue).not.toHaveBeenCalled();
  });
});
