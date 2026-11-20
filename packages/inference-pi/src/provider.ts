/**
 * Archer Harness — pi-ai provider 构建
 *
 * 目录路由沿用已安装 provider 的协议实现与原生鉴权；只有显式覆盖协议或
 * 目录中不存在的路由才由本包按协议表重建。凭据始终在请求前由推理层解析，
 * 这里只声明鉴权方式，不持有密钥。
 */

import type {
  Api,
  ApiKeyAuth,
  Model,
  Provider,
} from '@earendil-works/pi-ai';
import { createProvider } from '@earendil-works/pi-ai/models';
import type { ResolvedPiRoute } from './config.js';
import { catalogProvider } from './catalog.js';
import { PiInferenceError } from './errors.js';
import { PI_PROTOCOLS, protocolStreams } from './protocols.js';

/** provider 构建读取的路由事实 */
export interface PiProviderSpec {
  provider: string;
  displayName: string;
  api?: ResolvedPiRoute['api'];
  baseURL?: string;
  models: readonly Model<Api>[];
  /** 路由是否声明了凭据引用；只影响目录 provider 是否补上 api-key 鉴权 */
  namesCredential: boolean;
}

/**
 * 由推理层自行鉴权的 api-key 方式。
 * pi-ai 仅在 provider 声明 `apiKey` 时才接受请求级密钥覆盖，因此目录中
 * OAuth-only 的 provider 需要补上这一项，否则显式密钥会在发出请求前被拒绝。
 */
function harnessApiKeyAuth(name: string): ApiKeyAuth {
  return {
    name,
    resolve: ({ credential }) => Promise.resolve({
      auth: credential?.key === undefined ? {} : { apiKey: credential.key },
      source: name,
    }),
  };
}

/** 路由使用的鉴权方式：目录路由保留原生鉴权，必要时补上 api-key */
function routeAuth(spec: PiProviderSpec, catalog: Provider | undefined): Provider['auth'] {
  if (catalog === undefined) return { apiKey: harnessApiKeyAuth(spec.displayName) };
  if (catalog.auth.apiKey !== undefined || !spec.namesCredential) return catalog.auth;
  return { ...catalog.auth, apiKey: harnessApiKeyAuth(spec.displayName) };
}

/**
 * 复用目录 provider 的协议实现，只替换身份、模型与鉴权。
 * 目录 provider 可能持有本包无法重建的实现（如 Bedrock 的独立加载入口），
 * 因此保留它的 stream/streamSimple，而不是按协议表重建。
 */
function reuseCatalogProvider(base: Provider, spec: PiProviderSpec): Provider {
  const baseUrl = spec.baseURL ?? base.baseUrl;
  return {
    id: spec.provider,
    name: spec.displayName,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    auth: routeAuth(spec, base),
    getModels: () => spec.models,
    stream: (model, context, options) => base.stream(model, context, options),
    streamSimple: (model, context, options) => base.streamSimple(model, context, options),
  };
}

/**
 * 为一条已解析路由构建 pi-ai provider。
 * @param route - 解析后的路由事实。
 * @returns 可注册进 pi-ai Models 集合的 provider。
 * @throws {PiInferenceError} 当路由声明的协议无法被本包提供时。
 */
export function buildPiProvider(route: ResolvedPiRoute): Provider {
  const catalog = catalogProvider(route.provider);
  const spec: PiProviderSpec = {
    provider: route.provider,
    displayName: route.displayName,
    ...(route.api === undefined ? {} : { api: route.api }),
    ...(route.baseURL === undefined ? {} : { baseURL: route.baseURL }),
    models: route.models,
    namesCredential: route.apiKeyEnv !== undefined,
  };

  // 目录路由保留目录协议时整体复用；显式协议意味着部署方在重指向线协议，
  // 只有本包的协议表能服务。
  if (catalog !== undefined && route.api === undefined) {
    return reuseCatalogProvider(catalog, spec);
  }

  if (route.api === undefined) {
    throw new PiInferenceError(
      'CONFIG_INVALID',
      `inference-pi: provider "${route.provider}" 不在 pi-ai 目录中，必须声明 api；`
      + `可用协议：${Object.keys(PI_PROTOCOLS).join(', ')}`,
    );
  }

  return createProvider({
    id: route.provider,
    name: route.displayName,
    ...(route.baseURL === undefined ? {} : { baseUrl: route.baseURL }),
    auth: routeAuth(spec, catalog),
    models: route.models,
    api: protocolStreams(route.api),
  });
}
