/** 预算从已提交真实请求派生；缓存属于输入子集，缺失或未知不能记零。 */
import type { ErrorData } from '@archer/contracts';
import type { SessionInferenceRequest } from '@archer/agent';

export function usageAdmission(requests: readonly SessionInferenceRequest[], tokenBudget?: number): ErrorData | null {
  if (tokenBudget === undefined) return null;
  let consumed = 0;
  for (const request of requests) {
    if (request.status !== 'completed' || !request.result?.usage) return { code: 'TOKEN_USAGE_UNAVAILABLE', message: '推理用量缺失或尚未确认，无法核实本 Turn 的预算，已停止后续推理。' };
    consumed += request.result.usage.promptTokens + request.result.usage.completionTokens;
  }
  return consumed >= tokenBudget
    ? { code: 'TOKEN_BUDGET_EXCEEDED', message: `本 Turn 已使用 ${consumed} tokens，达到预算 ${tokenBudget}，已停止后续推理。` }
    : null;
}
