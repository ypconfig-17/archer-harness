/** 发送时复制默认值；排队和未知提交重试使用同一快照。 */
import { resolveContextProfile, type ContextProfile, type ModelSettings, type ReasoningLevel } from '@archer/contracts';
import { selectedInference } from './model-selection';

/** Profile 在提交时解析并深拷贝；后续编辑只影响新任务。 */
export function taskOptions(prefs: {
  model: string;
  reasoningByModel: Record<string, ReasoningLevel>;
  activeContextProfileId: string;
  customContextProfiles: readonly ContextProfile[];
  tokenBudget: number | null;
}, settings?: ModelSettings) {
  return {
    inference: {
      ...selectedInference(prefs.model, settings, prefs.reasoningByModel),
      contextProfile: resolveContextProfile(prefs.activeContextProfileId, prefs.customContextProfiles),
    },
    ...(prefs.tokenBudget === null ? {} : { limits: { tokenBudget: prefs.tokenBudget } }),
  };
}
