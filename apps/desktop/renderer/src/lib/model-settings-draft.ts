/** 模型设置草稿保留原始配置；只有显式保存才提交服务端，后台刷新不能覆盖编辑。 */
import type { JsonObject, JsonValue, ModelSettings, ModelSettingsUpdate } from '@archer/contracts';

export interface ModelServiceDraft {
  id: string;
  displayName: string;
  api: string;
  baseURL: string;
  apiKeyEnv: string;
  /** 仅表单临时持有，undefined 保留，null 移除。普通设置序列化不包含此字段。 */
  localKey?: string | null;
  defaultModel: string;
  extra: JsonObject;
}

export interface ModelDraft {
  defaultProvider: string;
  providers: ModelServiceDraft[];
}

export interface ModelDraftState {
  base: ModelSettings;
  draft: ModelDraft;
}

export function modelDraft(data: ModelSettings): ModelDraft {
  return {
    defaultProvider: String(data.config.defaultProvider ?? ''),
    providers: Object.entries(data.config.providers as JsonObject).map(([id, raw]) => {
      const profile = raw as JsonObject;
      return {
        id,
        displayName: String(profile.displayName ?? ''),
        api: String(profile.api ?? ''),
        baseURL: String(profile.baseURL ?? ''),
        apiKeyEnv: String(profile.apiKeyEnv ?? ''),
        defaultModel: String(profile.defaultModel ?? ''),
        extra: profile,
      };
    }),
  };
}

export function modelDraftDirty(state: ModelDraftState | null): boolean {
  return state !== null && JSON.stringify(state.draft) !== JSON.stringify(modelDraft(state.base));
}

type DraftAction =
  | { type: 'received'; data: ModelSettings }
  | { type: 'reset'; data: ModelSettings; pendingKeys?: ReadonlyMap<string, string | null> }
  | { type: 'edit'; draft: ModelDraft };

export function modelDraftReducer(state: ModelDraftState | null, action: DraftAction): ModelDraftState | null {
  if (action.type === 'edit') return state ? { ...state, draft: action.draft } : state;
  // 编辑中的来源版本保持固定，保存继续使用原 revision 做 CAS，不能将旧草稿伪装成新版本。
  if (action.type === 'received' && modelDraftDirty(state)) return state;
  const draft = modelDraft(action.data);
  if (action.type === 'reset' && action.pendingKeys) {
    for (const service of draft.providers) {
      // 保存时按去空格后的服务标识登记待写密钥，恢复时使用同一口径。
      const key = action.pendingKeys.get(service.id.trim());
      if (key !== undefined) service.localKey = key;
    }
  }
  return { base: action.data, draft };
}

export function serviceModels(service: ModelServiceDraft, catalog: ModelSettings['models']): JsonObject[] {
  // 草稿中的临时重名或空 ID 仍是独立条目，不能按 ID 查找后错误合并。
  if (Array.isArray(service.extra.models)) return service.extra.models as JsonObject[];
  return catalog.filter(model => model.provider === service.id).map(model => ({ id: model.id, name: model.name }));
}

/** 目录解析出的实际请求地址；本机密钥按它们绑定，同一服务可能包含多个端点。 */
export function resolvedBaseUrls(provider: string, catalog: ModelSettings['models']): string[] {
  return [...new Set(catalog.filter(model => model.provider === provider).map(model => model.baseUrl))]
    .filter(address => URL.canParse(address));
}

/** 编辑中的服务地址：手填地址优先，留空时沿用目录的实际地址。 */
export function serviceBaseUrls(service: ModelServiceDraft, catalog: ModelSettings['models']): string[] {
  const typed = service.baseURL.trim();
  return typed ? (URL.canParse(typed) ? [typed] : []) : resolvedBaseUrls(service.id.trim(), catalog);
}

export function modelSettingsUpdate(state: ModelDraftState): ModelSettingsUpdate {
  const providers: Record<string, JsonValue> = Object.create(null);
  for (const service of state.draft.providers) {
    const id = service.id.trim();
    if (!id || Object.hasOwn(providers, id)) throw new Error('服务标识不能为空或重复，请检查各服务的连接设置。');
    const profile: Record<string, JsonValue> = { ...service.extra };
    for (const key of ['displayName', 'api', 'baseURL', 'apiKeyEnv', 'defaultModel'] as const) {
      delete profile[key];
      if (service[key].trim()) profile[key] = service[key].trim();
    }
    if (Array.isArray(profile.models)) {
      const ids = profile.models.map(model => String((model as JsonObject).id ?? '').trim());
      if (ids.length === 0 || ids.some(model => !model)) throw new Error(`服务「${id}」存在空白模型 ID，请填写或移除该条目。`);
      if (new Set(ids).size !== ids.length) throw new Error(`服务「${id}」的模型 ID 重复，请使用不同的标识。`);
      profile.models = profile.models.map((model, index) => {
        const entry: Record<string, JsonValue> = { ...(model as JsonObject), id: ids[index]! };
        // 空显示名称按省略处理，服务端用模型 ID 展示自定义模型。
        if (typeof entry.name === 'string' && !entry.name.trim()) delete entry.name;
        return entry;
      });
      if (profile.defaultModel && !ids.includes(String(profile.defaultModel))) {
        throw new Error(`服务「${id}」的默认模型不在模型列表中，请重新选择。`);
      }
    }
    providers[id] = profile;
  }
  const defaultProvider = state.draft.defaultProvider.trim();
  if (defaultProvider && !Object.hasOwn(providers, defaultProvider)) throw new Error('默认服务已不存在，请重新选择。');
  const config: Record<string, JsonValue> = { ...state.base.config, providers };
  delete config.defaultProvider;
  if (defaultProvider) config.defaultProvider = defaultProvider;
  return { expectedRevision: state.base.revision, config };
}
