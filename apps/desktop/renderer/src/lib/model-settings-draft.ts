/** 模型设置草稿保留原始配置；只有显式保存才提交服务端，后台刷新不能覆盖编辑。 */
import type { JsonObject, JsonValue, ModelSettings, ModelSettingsUpdate } from '@archer/contracts';

export interface ModelServiceDraft {
  id: string;
  displayName: string;
  api: string;
  baseURL: string;
  apiKeyEnv: string;
  defaultModel: string;
  extra: JsonObject;
}

export interface ModelDraft {
  mode: ModelSettings['mode'];
  defaultProvider: string;
  providers: ModelServiceDraft[];
}

export interface ModelDraftState {
  base: ModelSettings;
  draft: ModelDraft;
}

export function modelDraft(data: ModelSettings): ModelDraft {
  return {
    mode: data.mode,
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
  | { type: 'received' | 'reset'; data: ModelSettings }
  | { type: 'edit'; draft: ModelDraft };

export function modelDraftReducer(state: ModelDraftState | null, action: DraftAction): ModelDraftState | null {
  if (action.type === 'edit') return state ? { ...state, draft: action.draft } : state;
  // 编辑中的来源版本保持固定，保存继续使用原 revision 做 CAS，不能将旧草稿伪装成新版本。
  if (action.type === 'received' && modelDraftDirty(state)) return state;
  return { base: action.data, draft: modelDraft(action.data) };
}

export function serviceModels(service: ModelServiceDraft, catalog: ModelSettings['models']): JsonObject[] {
  // 草稿中的临时重名或空 ID 仍是独立条目，不能按 ID 查找后错误合并。
  if (Array.isArray(service.extra.models)) return service.extra.models as JsonObject[];
  return catalog.filter(model => model.provider === service.id).map(model => ({ id: model.id, name: model.name }));
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
      profile.models = profile.models.map((model, index) => ({ ...(model as JsonObject), id: ids[index]! }));
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
  return { expectedRevision: state.base.revision, mode: state.draft.mode, config };
}
