/**
 * Archer Harness — 基于 pi-ai 的推理端口
 *
 * 推理层负责路由与模型选择、凭据引用解析、请求参数映射与结果投影。
 * 配置解析、provider 构建和上下文转换分别位于独立模块；这里只编排一次请求。
 */

import { readFile } from 'node:fs/promises';
import { channel } from 'node:diagnostics_channel';
import { createHash } from 'node:crypto';
import { REASONING_LEVELS, canonicalJson } from '@archer/contracts';
import type {
  AssistantMessage,
  Tool,
  Api,
  Model,
  ModelsSimpleStreamOptions,
  Usage as PiUsage,
} from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import { ZodError } from 'zod';
import type {
  InferConfig,
  InferEffect,
  InferResult,
  Inference,
  TokenUsage,
} from '@archer/contracts';
import {
  describeConfigError,
  parsePiConfig,
  resolvePiConfig,
  type ResolvedPiConfig,
  type ResolvedPiRoute,
} from './config.js';
import { toPiContext } from './context.js';
import { estimateTokens } from './estimate.js';
import { PiInferenceError } from './errors.js';
import { buildPiProvider } from './provider.js';

/** 推理端口附加只读诊断信息 */
export interface PiInference extends Inference {
  /** 已解析的 provider 路由键，按配置顺序排列 */
  readonly providers: readonly string[];
}

/** 推理过程的环境与传输注入点 */
export interface PiInferenceOptions {
  /** 读取凭据引用的环境变量来源；默认 process.env */
  env?: Readonly<Record<string, string | undefined>>;
  /** 宿主按实际请求地址解析本机凭据；未配置时沿用环境变量来源。 */
  resolveApiKey?: (provider: string, address: string) => Promise<string | undefined>;
  /** 覆盖 HTTP 实现，便于测试；默认使用全局 fetch */
  fetch?: typeof globalThis.fetch;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 从对外消息中移除已解析的凭据值 */
function redact(text: string, secret: string | undefined): string {
  if (secret === undefined || secret.length === 0) return text;
  return text.split(secret).join('[已隐藏]');
}

/** pi-ai 用量投影为 Archer 的 token 事实；缓存读写属于提示词侧 */
function usageOf(usage: PiUsage): TokenUsage | undefined {
  // SDK 在服务未回传用量时也会给出全零结构，不能据此确认请求没有消耗。
  if (usage.input + usage.cacheRead + usage.cacheWrite + usage.output === 0) return undefined;
  return {
    promptTokens: Math.max(0, usage.input + usage.cacheRead + usage.cacheWrite),
    completionTokens: Math.max(0, usage.output),
    cacheReadTokens: Math.max(0, usage.cacheRead),
    cacheWriteTokens: Math.max(0, usage.cacheWrite),
  };
}

function availableProviders(resolved: ResolvedPiConfig): string {
  return resolved.routes.map((route) => route.provider).join(', ');
}

function availableModels(route: ResolvedPiRoute): string {
  return route.models.map((model) => model.id).join(', ');
}

/** 选择本次请求的 provider 路由 */
function selectRoute(
  config: InferConfig | undefined,
  resolved: ResolvedPiConfig,
  routes: ReadonlyMap<string, ResolvedPiRoute>,
): ResolvedPiRoute {
  if (config?.provider !== undefined) {
    const route = routes.get(config.provider);
    if (route === undefined) {
      throw new PiInferenceError(
        'UNKNOWN_PROVIDER',
        `未配置服务「${config.provider}」；可用服务：${availableProviders(resolved)}`,
      );
    }
    return route;
  }

  if (resolved.defaultProvider !== undefined) {
    return routes.get(resolved.defaultProvider) as ResolvedPiRoute;
  }

  if (config?.model !== undefined) {
    const candidates = resolved.routes.filter(
      (route) => route.models.some((model) => model.id === config.model),
    );
    if (candidates.length === 1) return candidates[0] as ResolvedPiRoute;
    if (candidates.length > 1) {
      throw new PiInferenceError(
        'PROVIDER_REQUIRED',
        `模型「${config.model}」同时存在于多个服务（${candidates
          .map((route) => route.provider)
          .join(', ')}），请显式指定服务`,
      );
    }
    throw new PiInferenceError(
      'UNKNOWN_MODEL',
      `没有服务提供模型「${config.model}」；可用：${resolved.routes
        .map((route) => `${route.provider}(${availableModels(route)})`)
        .join(', ')}`,
    );
  }

  if (resolved.routes.length === 1) return resolved.routes[0] as ResolvedPiRoute;

  throw new PiInferenceError(
    'PROVIDER_REQUIRED',
    `存在多个服务，请在推理请求中指定服务；可用服务：${availableProviders(resolved)}`,
  );
}

/** 选择路由内的模型 */
function selectModel(
  route: ResolvedPiRoute,
  config: InferConfig | undefined,
): Model<Api> {
  const id = config?.model ?? route.defaultModel;
  if (id !== undefined) {
    const model = route.models.find((entry) => entry.id === id);
    if (model === undefined) {
      throw new PiInferenceError(
        'UNKNOWN_MODEL',
        `服务「${route.provider}」没有模型「${id}」；可用模型：${availableModels(route)}`,
      );
    }
    return model;
  }

  if (route.models.length === 1) return route.models[0] as Model<Api>;

  throw new PiInferenceError(
    'MODEL_REQUIRED',
    `服务「${route.provider}」提供多个模型，请在推理请求中指定模型；`
    + `可用模型：${availableModels(route)}`,
  );
}

/** 解析路由的凭据引用；缺省引用的路由按无鉴权端点处理 */
function resolveCredential(
  route: ResolvedPiRoute,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (route.apiKeyEnv === undefined) return undefined;
  const value = env[route.apiKeyEnv];
  if (value === undefined || value.trim().length === 0) {
    throw new PiInferenceError(
      'MISSING_CREDENTIAL',
      `服务「${route.provider}」需要环境变量 ${route.apiKeyEnv}，但该变量未设置或为空`,
    );
  }
  return value.trim();
}

/** 保留原生思考分块的边界、签名和来源，正文只保存一次。 */
function reasoningOf(message: AssistantMessage): Pick<InferResult, 'reasoning' | 'reasoningReplay'> {
  const blocks = message.content.filter(block => block.type === 'thinking');
  if (!blocks.length) return {};
  let cursor = 0;
  return { reasoning: blocks.map(block => block.thinking).join(''), reasoningReplay: {
    provider: message.provider, model: message.model, api: message.api,
    blocks: blocks.map(block => { const start = cursor; cursor += block.thinking.length; return { start, end: cursor,
      ...(block.thinkingSignature === undefined ? {} : { signature: block.thinkingSignature }), ...(block.redacted === undefined ? {} : { redacted: block.redacted }) }; }),
  } };
}

/** 把 pi-ai 响应投影为 InferResult，异常终止转换为公开错误 */
function toInferResult(message: AssistantMessage, apiKey: string | undefined): InferResult {
  switch (message.stopReason) {
    case 'toolUse':
    case 'stop':
    case 'length':
      return {
        stopReason: message.stopReason,
        content: message.content
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join(''),
        ...reasoningOf(message),
        toolCalls: (message.stopReason === 'length' ? [] : message.content.filter(block => block.type === 'toolCall')).map(call => {
          if (call.argumentsError) throw new PiInferenceError('PROVIDER_ERROR', '模型返回的工具参数不合法。');
          return { id: call.id, name: call.name, input: call.arguments, ...(call.thoughtSignature ? { signature: call.thoughtSignature } : {}), ...(call.namespace ? { namespace: call.namespace } : {}) };
        }),
        usage: usageOf(message.usage),
      };
    case 'aborted':
      throw new PiInferenceError('ABORTED', '推理请求已中止');
    case 'error':
      throw new PiInferenceError(
        'PROVIDER_ERROR',
        redact(message.errorMessage ?? '模型服务返回错误', apiKey),
      );
    default:
      throw new PiInferenceError(
        'PROVIDER_ERROR',
        `模型服务返回了不受支持的结束原因：「${message.stopReason}」`,
      );
  }
}

/**
 * 用已解析的配置创建推理端口。
 * @param input - AI 配置 JSON 值；通常来自 `HARNESS_AI_CONFIG` 指向的文件。
 * @param options - 凭据来源与 fetch 注入点。
 * @returns 可直接交给 Runtime 的推理端口。
 * @throws {PiInferenceError} 配置不合法、目录无法推断协议/端点或 provider 构建失败。
 */
export function createPiInference(
  input: unknown,
  options: PiInferenceOptions = {},
): PiInference {
  let config;
  try {
    config = parsePiConfig(input);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      throw new PiInferenceError('CONFIG_INVALID', `模型服务配置不合法：${describeConfigError(error)}`);
    }
    throw error;
  }

  let resolved: ResolvedPiConfig;
  try {
    resolved = resolvePiConfig(config);
  } catch (error: unknown) {
    throw new PiInferenceError('CONFIG_INVALID', messageOf(error));
  }

  const models = createModels(
    options.env === undefined
      ? undefined
      : {
          authContext: {
            env: (name) => Promise.resolve(options.env?.[name]),
            fileExists: () => Promise.resolve(false),
          },
        },
  );
  const routes = new Map<string, ResolvedPiRoute>();
  for (const route of resolved.routes) {
    try {
      models.setProvider(buildPiProvider(route, options.resolveApiKey !== undefined));
    } catch (error: unknown) {
      if (error instanceof PiInferenceError) throw error;
      throw new PiInferenceError('CONFIG_INVALID', messageOf(error));
    }
    routes.set(route.provider, route);
  }

  const env = options.env ?? process.env;

  return {
    providers: resolved.routes.map((route) => route.provider),
    measure(effect: InferEffect) {
      const route = selectRoute(effect.config, resolved, routes);
      const model = selectModel(route, effect.config);
      const context = toPiContext(effect.messages, model);
      context.tools = (effect.tools ?? []).map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters as Tool['parameters'] }));
      const supportedLevels = route.modelReasoning[model.id]?.levels ?? [];
      const lowestReasoning = REASONING_LEVELS.find(level => supportedLevels.includes(level));
      // 完整适配上下文按字符类别估算 token，并预留消息封装开销；这不是服务端 tokenizer。
      return { contextWindow: model.contextWindow, maxOutputTokens: model.maxTokens,
        // 图片编码长度不是视觉 token 数；以固定保守预留估算，避免 Base64 挤爆文本窗口。
        estimatedInputTokens: estimateTokens(JSON.stringify(context, (key, value) => key === 'data' ? undefined : value))
          + effect.messages.reduce((total, message) => total + (message.images?.length ?? 0) * 16_384, 0)
          + context.messages.length * 16,
        method: 'pi-context-token-classes-v1',
        ...(lowestReasoning ? { lowestReasoning } : {}) };
    },
    async infer(effect: InferEffect, signal: AbortSignal, onProgress): Promise<InferResult> {
      if (signal.aborted) throw new PiInferenceError('ABORTED', '推理请求已取消');

      const route = selectRoute(effect.config, resolved, routes);
      const model = selectModel(route, effect.config);
      const reasoning = effect.config?.reasoning ?? route.modelReasoning[model.id]!.default;
      if (!route.modelReasoning[model.id]!.levels.includes(reasoning)) throw new PiInferenceError('CONFIG_INVALID', `模型 ${model.id} 不支持推理等级 ${reasoning}`);
      // 本机密钥按模型解析后的实际地址查找；目录默认端点与显式覆盖都适用。
      const localKey = await options.resolveApiKey?.(route.provider, model.baseUrl);
      const apiKey = localKey ?? resolveCredential(route, env);
      const context = toPiContext(effect.messages, model);
      context.tools = (effect.tools ?? []).map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters as Tool['parameters'] }));
      const requestOptions: ModelsSimpleStreamOptions = {
        signal,
        // 重试由 Runtime 的 Effect 语义决定，provider SDK 不得自行重放请求。
        maxRetries: 0,
        ...(apiKey === undefined ? {} : { apiKey }),
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        ...(effect.config?.temperature === undefined
          ? {}
          : { temperature: effect.config.temperature }),
        ...(effect.config?.maxTokens === undefined
          ? {}
          : { maxTokens: effect.config.maxTokens }),
        ...(route.headers === undefined ? {} : { headers: route.headers }),
        ...(route.timeoutMs === undefined ? {} : { timeoutMs: route.timeoutMs }),
        ...(reasoning === 'off' ? {} : { reasoning }),
      };

      // 诊断只发布长度与请求指纹，不记录正文、凭据，也不进入执行事实。
      const diagnostics = channel('archer.stream');
      const responseId = diagnostics.hasSubscribers
        ? createHash('sha256').update(canonicalJson(JSON.parse(JSON.stringify(effect)))).digest('hex').slice(0, 16)
        : undefined;
      let visibleChars = 0;
      let reasoningChars = 0;
      const trace = (event: string, content = visibleChars, reasoning = reasoningChars) => {
        visibleChars = content;
        reasoningChars = reasoning;
        if (diagnostics.hasSubscribers) diagnostics.publish({ stage: 'Provider', responseId, event, content, reasoning });
      };
      trace('start');
      let message: AssistantMessage;
      try {
        const stream = models.streamSimple(model, context, requestOptions);
        for await (const event of stream) {
          if (event.type !== 'text_delta' && event.type !== 'thinking_delta') {
            trace(event.type);
            continue;
          }
          if (diagnostics.hasSubscribers) {
            trace(
              event.type,
              event.partial.content.reduce((n, block) => n + (block.type === 'text' ? block.text.length : 0), 0),
              event.partial.content.reduce((n, block) => n + (block.type === 'thinking' ? block.thinking.length : 0), 0),
            );
          }
          const partial = event.partial;
          try {
            onProgress?.({
              content: partial.content.map(block => block.type === 'text' ? block.text : '').join(''),
              reasoning: partial.content.map(block => block.type === 'thinking' ? block.thinking : '').join(''),
            });
          } catch {
            // 临时进度观察失败不改变本次模型调用的最终结果。
          }
        }
        message = await stream.result();
      } catch (error: unknown) {
        if (signal.aborted) throw new PiInferenceError('ABORTED', '推理请求已取消');
        throw new PiInferenceError('PROVIDER_ERROR', redact(messageOf(error), apiKey));
      }
      return { ...toInferResult(message, apiKey), reasoningLevel: reasoning };
    },
  };
}

/**
 * 从 JSON 文件加载 AI 配置并创建推理端口。
 * @param path - 配置文件路径。
 * @param options - 环境变量与 fetch 注入点。
 * @returns 可直接交给 Runtime 的推理端口。
 * @throws {PiInferenceError} 文件不可读、不是合法 JSON 或配置校验失败。
 */
export async function loadPiInference(
  path: string,
  options: PiInferenceOptions = {},
): Promise<PiInference> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error: unknown) {
    throw new PiInferenceError(
      'CONFIG_INVALID',
      `无法读取模型配置文件 ${path}：${messageOf(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    throw new PiInferenceError(
      'CONFIG_INVALID',
      `模型配置文件不是合法 JSON（${path}）：${messageOf(error)}`,
    );
  }
  return createPiInference(parsed, options);
}
