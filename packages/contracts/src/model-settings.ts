/** 应用模型设置；凭据仅保存环境变量引用。 */
import { z } from 'zod';
import type { ReasoningLevel } from './reasoning.js';
import { JsonObjectSchema } from './json-schema.js';
export const ModelSettingsUpdateSchema = z.strictObject({
  expectedRevision: z.string().min(1),
  mode: z.enum(['mock', 'pi']),
  config: JsonObjectSchema,
});
export type ModelSettingsUpdate = z.infer<typeof ModelSettingsUpdateSchema>;
export interface ModelSettings {
  revision: string;
  mode: 'mock' | 'pi';
  config: z.infer<typeof JsonObjectSchema>;
  models: readonly { provider: string; id: string; name: string; reasoningLevels: readonly ReasoningLevel[]; defaultReasoning: ReasoningLevel }[];
  defaultModel?: { provider: string; id: string };
  protocols: readonly string[];
}
