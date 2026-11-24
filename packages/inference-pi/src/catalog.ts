/**
 * Archer Harness — pi-ai 模型目录解析
 *
 * 目录 provider 自带模型清单与线协议，配置只需声明路由即可直接使用。
 * 显式 models 列表会替换目录清单，未填写的字段从同 id 的目录条目继承，
 * 再回退到路由默认值；这样新增模型只需填写 id，修正模型只需覆盖差异。
 */

import type {
  Api,
  Model,
  ModelCost,
  ModelInputModality,
  ModelThinkingLevel,
  Provider,
} from '@earendil-works/pi-ai';
import {
  builtinProviders,
  getBuiltinModels,
  type BuiltinProvider,
} from '@earendil-works/pi-ai/providers/all';

/** 目录未描述模型时使用的零成本；Archer 不消费 pi-ai 的费用数据 */
const NO_COST: ModelCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** 目录未声明输入模态时的保守默认值 */
const DEFAULT_INPUT: readonly ModelInputModality[] = ['text'];

/**
 * 模型输入模态全集。`Record` 键类型是漂移闸门：pi-ai 升级新增或删除模态时
 * 在这里编译失败并指出键名，而不是悄悄收窄配置能声明的范围。
 */
const MODALITY_GATE: Record<ModelInputModality, true> = {
  text: true,
  image: true,
};

/** 配置可声明的输入模态 */
export const MODALITIES = Object.keys(MODALITY_GATE) as [
  ModelInputModality,
  ...ModelInputModality[],
];

/**
 * pi-ai 的思考等级全集，按升级顺序排列。同样是漂移闸门：上游新增等级时，
 * 配置枚举不会静默缺少该项。
 */
const THINKING_LEVEL_GATE: Record<ModelThinkingLevel, true> = {
  off: true,
  minimal: true,
  low: true,
  medium: true,
  high: true,
  xhigh: true,
  max: true,
};

/** 配置可声明的思考等级 */
export const THINKING_LEVELS = Object.keys(THINKING_LEVEL_GATE) as [
  ModelThinkingLevel,
  ...ModelThinkingLevel[],
];

/** 一条模型声明；字段未填写表示继承目录条目或路由默认值 */
export interface ModelDeclaration {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  input?: readonly ModelInputModality[];
  reasoning?: boolean;
}

/** 一条路由的模型解析输入 */
export interface RouteModelRequest {
  /** 路由键，同时写入每个模型的 provider */
  provider: string;
  /** 协议覆盖；缺省沿用目录条目自身的协议 */
  api?: string;
  /** 端点覆盖；缺省沿用目录条目或目录 provider 的端点 */
  baseURL?: string;
  /** 显式模型清单；缺省表示完整使用目录清单 */
  models?: readonly ModelDeclaration[];
  /** 目录与声明都未给出容量时的回退值 */
  defaultContextWindow: number;
  /** 目录与声明都未给出输出能力时的回退值 */
  defaultMaxTokens: number;
}

let providerIndex: Map<string, Provider> | undefined;

/** 目录 provider 按 id 缓存；每个 provider 拥有自己的协议实现 */
function catalogProviders(): Map<string, Provider> {
  providerIndex ??= new Map(builtinProviders().map((provider) => [provider.id, provider]));
  return providerIndex;
}

/** 查找 pi-ai 内置 provider */
export function catalogProvider(provider: string): Provider | undefined {
  return catalogProviders().get(provider);
}

/** 读取内置 provider 的模型，按 id 索引 */
function catalogModels(provider: string): Map<string, Model<Api>> {
  if (!catalogProviders().has(provider)) return new Map();
  const models = getBuiltinModels(provider as BuiltinProvider) as Model<Api>[];
  return new Map(models.map((model) => [model.id, model]));
}

/** 目录中所有模型共同使用的协议；协议不一致时返回 undefined */
function sharedCatalogApi(models: ReadonlyMap<string, Model<Api>>): string | undefined {
  const apis = new Set<string>();
  for (const model of models.values()) apis.add(model.api);
  return apis.size === 1 ? [...apis][0] : undefined;
}

/** 复制目录模型并应用路由级覆盖 */
function withRouteOverrides(
  model: Model<Api>,
  request: RouteModelRequest,
): Model<Api> {
  return {
    ...model,
    provider: request.provider,
    ...(request.api === undefined ? {} : { api: request.api }),
    ...(request.baseURL === undefined ? {} : { baseUrl: request.baseURL }),
  };
}

/** 从目录条目与路由默认值合并出一条模型 */
function resolveModel(
  entry: ModelDeclaration,
  base: Model<Api> | undefined,
  request: RouteModelRequest,
  sharedApi: string | undefined,
  providerBaseUrl: string | undefined,
  seen: Set<string>,
): Model<Api> {
  if (seen.has(entry.id)) {
    throw new Error(`服务「${request.provider}」重复声明模型「${entry.id}」`);
  }
  seen.add(entry.id);

  // 错误消息面向设置页使用者：只使用服务、模型、协议和 API 地址等产品词汇。
  const api = request.api ?? base?.api ?? sharedApi;
  if (api === undefined) {
    throw new Error(
      `模型「${entry.id}」不在内置模型目录中，无法确定协议；`
      + `请为服务「${request.provider}」填写协议`,
    );
  }
  const baseUrl = request.baseURL ?? base?.baseUrl ?? providerBaseUrl;
  if (baseUrl === undefined) {
    throw new Error(
      `模型「${entry.id}」不在内置模型目录中，无法确定 API 地址；`
      + `请为服务「${request.provider}」填写 API 地址`,
    );
  }

  return {
    ...base,
    id: entry.id,
    name: entry.name ?? base?.name ?? entry.id,
    api,
    provider: request.provider,
    baseUrl,
    input: entry.input === undefined
      ? base?.input ?? [...DEFAULT_INPUT]
      : [...entry.input],
    cost: base?.cost ?? NO_COST,
    contextWindow: entry.contextWindow ?? base?.contextWindow ?? request.defaultContextWindow,
    maxTokens: entry.maxTokens ?? base?.maxTokens ?? request.defaultMaxTokens,
    reasoning: entry.reasoning ?? base?.reasoning ?? false,
  };
}

/**
 * 解析一条路由的模型清单。
 * @param request - 路由级模型事实。
 * @returns 按配置顺序排列的模型；显式清单替换目录，而不是追加。
 * @throws Error 当路由既无目录清单、又无可用的协议或端点时。
 */
export function resolveRouteModels(request: RouteModelRequest): readonly Model<Api>[] {
  const defaults = catalogModels(request.provider);
  const providerBaseUrl = catalogProvider(request.provider)?.baseUrl;

  if (request.models === undefined) {
    if (defaults.size === 0) {
      throw new Error(
        `服务「${request.provider}」不在内置模型目录中，且没有添加模型；`
        + '请使用内置服务标识，或至少添加一个模型',
      );
    }
    return [...defaults.values()].map((model) => withRouteOverrides(model, request));
  }

  const sharedApi = sharedCatalogApi(defaults);
  const seen = new Set<string>();
  const models: Model<Api>[] = [];
  for (const entry of request.models) {
    models.push(resolveModel(
      entry,
      defaults.get(entry.id),
      request,
      sharedApi,
      providerBaseUrl,
      seen,
    ));
  }
  return models;
}
