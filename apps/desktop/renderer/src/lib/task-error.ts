/** 只转换明确的余额不足信号；未知错误保留原文，避免仅凭 402 猜测原因。 */
export function taskErrorMessage(message: string): string {
  const payload = message.replace(/^\s*402\s*:\s*/, '').trim();
  let insufficientBalance = /^insufficient balance(?:\s*\(request_id:[^)]*\))?$/i.test(payload);
  try {
    const parsed: unknown = JSON.parse(payload);
    if (parsed && typeof parsed === 'object') {
      const envelope = parsed as Record<string, unknown>;
      const error = envelope.error && typeof envelope.error === 'object'
        ? envelope.error as Record<string, unknown>
        : envelope;
      insufficientBalance = error.type === 'insufficient_balance_error'
        || error.code === 'insufficient_balance_error'
        || typeof error.message === 'string'
          && /^insufficient balance(?:\s*\(request_id:[^)]*\))?$/i.test(error.message.trim());
    }
  } catch {
    // 上游也可能返回普通文本，解析失败时沿用明确文本匹配结果。
  }
  return insufficientBalance
    ? '模型服务余额不足，请充值或切换模型后重试。'
    : message;
}
