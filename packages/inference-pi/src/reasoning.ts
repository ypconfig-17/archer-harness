/** 推理等级以实际模型能力为准，显式选择不做静默降级。 */
import type { Api, Model, ModelThinkingLevel } from '@earendil-works/pi-ai';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai/models';
import type { ReasoningLevel } from '@archer/contracts';
export interface ModelReasoning {
  levels: readonly ReasoningLevel[];
  default: ReasoningLevel;
}
export function modelReasoning(model: Model<Api>, declaration?: { reasoningLevels?: ReasoningLevel[]; defaultReasoning?: ReasoningLevel }, routeDefault?: ModelThinkingLevel): ModelReasoning {
  const supported = getSupportedThinkingLevels(model);
  const levels = declaration?.reasoningLevels ?? supported;
  if (!levels.length || new Set(levels).size !== levels.length || levels.some(level => !supported.includes(level))) throw new Error(`模型 ${model.id} 的推理等级配置超出实际支持范围：${supported.join(', ')}`);
  const configured = declaration?.defaultReasoning ?? (model.reasoning ? routeDefault : undefined);
  const fallback = (['medium', 'high', 'low', 'minimal', 'xhigh', 'max', 'off'] as const).find(level => levels.includes(level))!;
  const selected = configured ?? fallback;
  if (!levels.includes(selected)) throw new Error(`模型 ${model.id} 不支持默认推理等级 ${selected}`);
  return { levels: [...levels], default: selected };
}
