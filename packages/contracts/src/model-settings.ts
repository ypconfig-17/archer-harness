/** 应用模型设置；凭据不进入设置文档，桌面本机密钥按服务与实际请求地址绑定。 */
import { z } from 'zod';
import type { ReasoningLevel } from './reasoning.js';
import { JsonObjectSchema } from './json-schema.js';
/** 设置文档只描述服务与协议；未配置服务时推理请求明确失败，不提供模拟响应。 */
export const ModelSettingsUpdateSchema = z.strictObject({
  expectedRevision: z.string().min(1),
  config: JsonObjectSchema,
});
export type ModelSettingsUpdate = z.infer<typeof ModelSettingsUpdateSchema>;
export interface ModelSettings {
  revision: string;
  config: z.infer<typeof JsonObjectSchema>;
  /** baseUrl 为解析后的实际请求地址；本机密钥按它绑定，目录服务无需手填地址。 */
  models: readonly { provider: string; id: string; name: string; baseUrl: string; reasoningLevels: readonly ReasoningLevel[]; defaultReasoning: ReasoningLevel }[];
  defaultModel?: { provider: string; id: string };
  protocols: readonly string[];
}