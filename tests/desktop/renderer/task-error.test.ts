import { describe, expect, it } from 'vitest';
import { taskErrorMessage } from '../../../apps/desktop/renderer/src/lib/task-error';

describe('任务余额不足提示', () => {
  it.each([
    '402: {"message":"Insufficient Balance (request_id: 1446e71d-9171-4147-9b80-d3d8ffdea206)","type":"insufficient_balance_error","param":null,"code":"invalid_request_error"}',
    '{"error":{"type":"insufficient_balance_error"}}',
    '{"error":{"code":"insufficient_balance_error"}}',
    '{"message":"Insufficient Balance"}',
    '402: Insufficient Balance',
  ])('将明确的余额不足错误转成可操作提示：%s', message => {
    expect(taskErrorMessage(message)).toBe('模型服务余额不足，请充值或切换模型后重试。');
  });

  it.each([
    '402: Payment Required',
    '402: {"code":"invalid_request_error","message":"Invalid model"}',
    '402: {invalid json',
    '工具输出包含 Insufficient Balance，但执行失败原因未知',
    'Network disconnected',
    '',
  ])('未知错误保持原文，不猜测余额：%s', message => {
    expect(taskErrorMessage(message)).toBe(message);
  });
});
