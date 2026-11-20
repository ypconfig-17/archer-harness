/** 完整请求的窗口准入；估算方法由固定推理能力声明，不伪装精确计数。 */
import { OperationRejected, type InferEffect, type Inference } from '@archer/contracts';

export function measureWindow(effect: InferEffect, inference: Inference) {
  if (!inference.measure) return undefined;
  const measurement = inference.measure(effect);
  if (!measurement) return undefined;
  if (!Number.isSafeInteger(measurement.contextWindow) || measurement.contextWindow <= 0
    || !Number.isSafeInteger(measurement.maxOutputTokens) || measurement.maxOutputTokens <= 0
    || !Number.isSafeInteger(measurement.estimatedInputTokens) || measurement.estimatedInputTokens < 0
    || typeof measurement.method !== 'string' || !measurement.method.trim()) {
    throw new OperationRejected('Inference measurement is invalid.', 'PROVIDER_ERROR');
  }
  // 缺省时按模型上限保守预留，不改写实际请求的生成配置。
  const outputReserve = effect.config?.maxTokens ?? measurement.maxOutputTokens;
  if (outputReserve > measurement.maxOutputTokens) throw new OperationRejected('Requested output exceeds the model output limit.', 'CONTEXT_BUDGET_EXCEEDED');
  const safetyMargin = Math.max(256, Math.ceil(measurement.contextWindow * 0.02));
  if (outputReserve + safetyMargin > measurement.contextWindow) throw new OperationRejected('输出预留与安全余量超过模型窗口，无法容纳请求。', 'CONTEXT_BUDGET_EXCEEDED');
  const inputLimit = measurement.contextWindow - outputReserve - safetyMargin;
  return { estimatedInputTokens: measurement.estimatedInputTokens, inputLimit, outputReserve, safetyMargin, method: measurement.method };
}

export function assertWindow(effect: InferEffect, inference: Inference) {
  const window = measureWindow(effect, inference);
  if (window && window.estimatedInputTokens > window.inputLimit) throw new OperationRejected('完整模型请求超过输入预算；用户消息、固定规则或必要协议开销不能继续缩减。', 'CONTEXT_BUDGET_EXCEEDED');
  return window;
}
