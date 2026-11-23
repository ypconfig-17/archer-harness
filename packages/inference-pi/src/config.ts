/**
 * Archer Harness — pi-ai 推理配置
 *
 * 配置以 provider 路由为键：目录 provider 只需声明路由即可获得端点、协议与
 * 模型清单，非目录 provider 由配置完整描述。凭据只保存环境变量名，配置文档
 * 中不出现明文密钥。
 */

import type { Api, Model, ModelThinkingLevel } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { ReasoningLevelSchema } from '@archer/contracts';
import { modelReasoning, type ModelReasoning } from './reasoning.js';
import {
  MODALITIES,
  resolveRouteModels,
  THINKING_LEVELS,
} from './catalog.js';
import { PI_PROTOCOL_IDS, type PiProtocol } from './protocols.js';

/** 目录与声明都没有容量时的上下文回退值 */
export const DEFAULT_CONTEXT_WINDOW = 262_144;

/** 目录与声明都没有输出能力时的回退值 */
export const DEFAULT_MAX_TOKENS = 32_768;

/** 环境变量名；配置只保存引用，不保存密钥本身 */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 一条模型声明；未填写字段从同 id 的目录条目继承，再回退到路由默认值 */
export const PiModelConfigSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  input: z.array(z.enum(MODALITIES)).min(1).optional(),
  reasoning: z.boolean().optional(),
  reasoningLevels: z.array(ReasoningLevelSchema).min(1).optional(),
  defaultReasoning: ReasoningLevelSchema.optional(),
});
export type PiModelConfig = z.infer<typeof PiModelConfigSchema>;

/** 一条 provider 路由 */
export const PiProviderConfigSchema = z.strictObject({
  /** 选择器展示名；缺省使用目录名称或路由键 */
  displayName: z.string().min(1).optional(),
  /** 该路由所有模型的线协议覆盖；目录路由缺省沿用各模型自身的协议 */
  api: z.enum(PI_PROTOCOL_IDS).optional(),
  /** 端点覆盖；目录路由缺省沿用目录端点 */
  baseURL: z.url().optional(),
  /** 凭据来源的环境变量名 */
  apiKeyEnv: z.string().regex(ENV_NAME, '必须是合法的环境变量名').optional(),
  /** 显式模型清单；缺省完整使用目录清单，显式清单替换目录而不是追加 */
  models: z.array(PiModelConfigSchema).min(1).optional(),
  /** 请求未指定模型时使用的模型；必须位于解析后的模型清单中 */
  defaultModel: z.string().min(1).optional(),
  defaultContextWindow: z.number().int().positive().default(DEFAULT_CONTEXT_WINDOW),
  defaultMaxTokens: z.number().int().positive().default(DEFAULT_MAX_TOKENS),
  /** 附加到每个请求的 HTTP 头 */
  headers: z.record(z.string().min(1), z.string()).optional(),
  /** 请求的推理等级；off 表示不发送等级参数 */
  reasoning: z.enum(THINKING_LEVELS).optional(),
  /** provider SDK 的单次请求超时 */
  timeoutMs: z.number().int().positive().optional(),
});
export type PiProviderConfig = z.infer<typeof PiProviderConfigSchema>;

/** 完整配置文件 */
export const PiInferenceConfigSchema = z.strictObject({
  /** 请求未指定 provider 时使用的路由 */
  defaultProvider: z.string().min(1).optional(),
  providers: z.record(z.string().min(1), PiProviderConfigSchema),
});
export type PiInferenceConfig = z.infer<typeof PiInferenceConfigSchema>;

/** 已解析的单条路由 */
export interface ResolvedPiRoute {
  provider: string;
  displayName: string;
  api?: PiProtocol;
  baseURL?: string;
  apiKeyEnv?: string;
  models: readonly Model<Api>[];
  modelReasoning: Readonly<Record<string, ModelReasoning>>;
  defaultModel?: string;
  headers?: Readonly<Record<string, string>>;
  reasoning?: ModelThinkingLevel;
  timeoutMs?: number;
}

/** 已解析的完整配置 */
export interface ResolvedPiConfig {
  defaultProvider?: string;
  routes: readonly ResolvedPiRoute[];
}

/** 把配置问题压成一条可读消息，带出字段路径 */
function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => (
      issue.path.length === 0 ? issue.message : `${issue.path.join('.')}：${issue.message}`
    ))
    .join('；');
}

/**
 * 校验原始配置值。
 * @param input - 已解析的 JSON 值。
 * @returns 带默认值与枚举约束的配置。
 * @throws {z.ZodError} 配置结构不合法。
 */
export function parsePiConfig(input: unknown): PiInferenceConfig {
  return PiInferenceConfigSchema.parse(input);
}

/** 供调用方把 ZodError 转成公开错误消息 */
export function describeConfigError(error: z.ZodError): string {
  return formatIssues(error);
}

/**
 * 把配置解析成路由与模型清单。
 * @param config - 已通过 schema 校验的配置。
 * @returns 路由顺序与配置书写顺序一致。
 * @throws Error 当路由没有可用模型、目录无法推断协议/端点或默认值引用不存在的项时。
 */
export function resolvePiConfig(config: PiInferenceConfig): ResolvedPiConfig {
  const entries = Object.entries(config.providers);
  if (entries.length === 0) {
    throw new Error('inference-pi: providers 不能为空');
  }

  const routes = entries.map(([provider, profile]): ResolvedPiRoute => {
    const models = resolveRouteModels({
      provider,
      ...(profile.api === undefined ? {} : { api: profile.api }),
      ...(profile.baseURL === undefined ? {} : { baseURL: profile.baseURL }),
      ...(profile.models === undefined ? {} : { models: profile.models }),
      defaultContextWindow: profile.defaultContextWindow,
      defaultMaxTokens: profile.defaultMaxTokens,
    });
    if (
      profile.defaultModel !== undefined
      && !models.some((model) => model.id === profile.defaultModel)
    ) {
      throw new Error(
        `inference-pi: provider "${provider}" 的 defaultModel "${profile.defaultModel}" `
        + `不在模型清单中；可用模型：${models.map((model) => model.id).join(', ')}`,
      );
    }
    return {
      provider,
      displayName: profile.displayName ?? provider,
      ...(profile.api === undefined ? {} : { api: profile.api }),
      ...(profile.baseURL === undefined ? {} : { baseURL: profile.baseURL }),
      ...(profile.apiKeyEnv === undefined ? {} : { apiKeyEnv: profile.apiKeyEnv }),
      models,
      modelReasoning: Object.fromEntries(models.map(model => [model.id, modelReasoning(model, profile.models?.find(item => item.id === model.id), profile.reasoning)])),
      ...(profile.defaultModel === undefined ? {} : { defaultModel: profile.defaultModel }),
      ...(profile.headers === undefined ? {} : { headers: profile.headers }),
      ...(profile.reasoning === undefined ? {} : { reasoning: profile.reasoning }),
      ...(profile.timeoutMs === undefined ? {} : { timeoutMs: profile.timeoutMs }),
    };
  });

  if (
    config.defaultProvider !== undefined
    && !Object.hasOwn(config.providers, config.defaultProvider)
  ) {
    throw new Error(
      `inference-pi: defaultProvider "${config.defaultProvider}" 不是已配置的 provider；`
      + `可用：${entries.map(([provider]) => provider).join(', ')}`,
    );
  }

  return {
    ...(config.defaultProvider === undefined
      ? {}
      : { defaultProvider: config.defaultProvider }),
    routes,
  };
}
