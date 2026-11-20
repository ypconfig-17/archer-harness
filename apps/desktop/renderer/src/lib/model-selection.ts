/** 模型及推理等级是一次提交的显式配置；本机偏好只提供初始选择。 */
import type { InferConfig, ModelSettings, ReasoningLevel } from '@archer/contracts';
export const REASONING_LABELS: Record<ReasoningLevel, string> = { off: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高' };
export function modelKey(model: { provider: string; id: string }): string { return JSON.stringify([model.provider, model.id]); }
export function selectedModel(selection: string, settings?: ModelSettings) {
  if (settings?.mode !== 'pi') return undefined;
  const requested = selection ? settings.models.find(model => modelKey(model) === selection) : undefined;
  return requested ?? settings.models.find(model => model.provider === settings.defaultModel?.provider && model.id === settings.defaultModel.id);
}
export function selectedReasoning(model: ModelSettings['models'][number], preferences: Readonly<Record<string, ReasoningLevel | undefined>>): ReasoningLevel {
  const saved = preferences[modelKey(model)];
  return saved && model.reasoningLevels.includes(saved) ? saved : model.defaultReasoning;
}
export function selectedInference(selection: string, settings?: ModelSettings, preferences: Readonly<Record<string, ReasoningLevel | undefined>> = {}): InferConfig | undefined {
  const model = selectedModel(selection, settings);
  return model ? { provider: model.provider, model: model.id, reasoning: selectedReasoning(model, preferences) } : undefined;
}
