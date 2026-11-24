/** 服务端模型设置与推理端口装配，不参与 Agent 调度。 */
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import type { Inference, ModelSettings, ModelSettingsUpdate, JsonObject, JsonValue } from '@archer/contracts';
import { ArcherError } from '@archer/contracts';
import { createPiInference, parsePiConfig, resolvePiConfig, PI_PROTOCOL_IDS, type PiInferenceOptions } from '@archer/inference-pi';

/** 未配置模型服务时的推理端口：明确失败，不返回模拟答复。 */
function unconfiguredInference(): Inference {
  const fail = (): never => {
    throw new ArcherError('CAPABILITY_UNAVAILABLE', '尚未配置模型服务，请先在「设置 → 模型设置」完成配置。');
  };
  return { measure: () => fail(), infer: async () => fail() };
}

export interface ModelSettingsService {
  inference: Inference;
  get(): ModelSettings;
  update(input: ModelSettingsUpdate): Promise<ModelSettings>;
}
export async function createModelSettings(
  path: string,
  initialConfigPath?: string,
  inferenceOptions?: PiInferenceOptions,
): Promise<ModelSettingsService> {
  let stored: { config: JsonObject };
  try { stored = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    stored = { config: initialConfigPath ? JSON.parse(await readFile(initialConfigPath, 'utf8')) : { providers: {} } };
  }
  function prepare(value: typeof stored) {
    const config = parsePiConfig(value.config);
    let resolved: ReturnType<typeof resolvePiConfig> | null;
    let port: Inference;
    try {
      // 空配置是合法的首次状态：设置页仍可读取并保存服务，推理请求明确失败。
      resolved = Object.keys(config.providers).length ? resolvePiConfig(config) : null;
      port = resolved ? createPiInference(config, inferenceOptions) : unconfiguredInference();
    } catch (error) {
      // 目录与端点推断失败是配置问题；不能让普通异常降级成 500 掩盖原因。
      // inference-pi 的错误消息已使用产品词汇，直接透出即可。
      const detail = error instanceof Error ? error.message : String(error);
      throw new ArcherError('INVALID_ARGUMENT', `模型服务配置无效：${detail}`);
    }
    const publicConfig = JSON.parse(JSON.stringify(config)) as JsonObject;
    // 请求头可能携带凭据，不向浏览器返回，也不接受浏览器修改。
    for (const profile of Object.values(publicConfig.providers as JsonObject)) if (profile && typeof profile === 'object' && !Array.isArray(profile)) delete (profile as Record<string, JsonValue>).headers;
    const defaultRoute = resolved?.routes.find(route => route.provider === resolved.defaultProvider) ?? (resolved?.routes.length === 1 ? resolved.routes[0] : undefined);
    const defaultModel = defaultRoute?.defaultModel ?? (defaultRoute?.models.length === 1 ? defaultRoute.models[0]!.id : undefined);
    // baseUrl 是解析后的实际请求端点；桌面本机密钥按它绑定，不依赖是否手填地址。
    return { port, publicConfig, defaultModel: defaultRoute && defaultModel ? { provider: defaultRoute.provider, id: defaultModel } : undefined, models: resolved?.routes.flatMap(route => route.models.map(model => ({ provider: route.provider, id: model.id, name: model.name, baseUrl: model.baseUrl, reasoningLevels: route.modelReasoning[model.id]!.levels, defaultReasoning: route.modelReasoning[model.id]!.default }))) ?? [] };
  }
  let current = prepare(stored);
  const version = () => createHash('sha256').update(JSON.stringify(stored)).digest('hex');
  let queue = Promise.resolve();
  const get = (): ModelSettings => ({ revision: version(), config: structuredClone(current.publicConfig), models: current.models, ...(current.defaultModel ? { defaultModel: current.defaultModel } : {}), protocols: PI_PROTOCOL_IDS });
  return {
    // 调用开始时固定端口；设置变更不替换已经发出的请求。
    inference: { measure: effect => current.port.measure?.(effect), infer: (effect, signal, onProgress) => current.port.infer(effect, signal, onProgress) },
    get,
    update(input) {
      const operation = queue.then(async () => {
        if (input.expectedRevision !== version()) throw new ArcherError('CONFLICT', '设置已被修改，请重新加载后保存');
        const config = parsePiConfig(input.config);
        const previous = parsePiConfig(stored.config);
        for (const [key, profile] of Object.entries(config.providers)) {
          if (profile.headers) throw new ArcherError('INVALID_ARGUMENT', '浏览器设置不接受自定义请求头');
          const headers = previous.providers[key]?.headers;
          if (headers) profile.headers = headers;
        }
        const next = { config: JSON.parse(JSON.stringify(config)) as JsonObject };
        const prepared = prepare(next);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(`${path}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
        await rename(`${path}.tmp`, path);
        stored = next; current = prepared;
        return get();
      });
      queue = operation.then(() => undefined, () => undefined);
      return operation;
    },
  };
}
