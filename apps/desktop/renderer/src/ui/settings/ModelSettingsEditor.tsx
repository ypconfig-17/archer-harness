import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, ConfirmDialog, Icon, Input, NativeSelect } from '@archer/ui';
import { useEffect, useReducer, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { JsonObject, ModelSettings } from '@archer/contracts';
import { client } from '../../lib/api';
import { REASONING_LABELS } from '../../lib/model-selection';
import {
  modelDraftDirty,
  modelDraftReducer,
  modelSettingsUpdate,
  resolvedBaseUrls,
  serviceBaseUrls,
  serviceModels,
  type ModelDraft,
  type ModelServiceDraft,
} from '../../lib/model-settings-draft';
import { useModelSettings } from '../workspace/ComposerControls';
import { SettingRow, SettingsSaveBar, type SettingsEditorState } from './SettingsControls';

const localKeys = window.archerDesktop?.serviceKey === 'desktop-local' ? window.archerDesktop : undefined;

export function ModelSettingsEditor({ onStateChange }: { onStateChange(state: SettingsEditorState): void }) {
  const query = useModelSettings();
  const cache = useQueryClient();
  const [state, dispatch] = useReducer(modelDraftReducer, null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const dirty = modelDraftDirty(state);

  useEffect(() => {
    if (query.data) dispatch({ type: 'received', data: query.data });
  }, [query.data]);
  useEffect(() => onStateChange({ dirty, busy }), [dirty, busy, onStateChange]);

  function edit(draft: ModelDraft) {
    dispatch({ type: 'edit', draft });
    setSaved('');
    setError('');
  }

  function editService(index: number, value: Partial<ModelServiceDraft>) {
    if (!state) return;
    const { draft } = state;
    const defaultProvider = value.id !== undefined && Boolean(draft.defaultProvider) && draft.providers[index]?.id === draft.defaultProvider
      ? value.id
      : draft.defaultProvider;
    edit({
      ...draft,
      defaultProvider,
      providers: draft.providers.map((service, position) => position === index ? { ...service, ...value } : service),
    });
  }

  async function save() {
    if (!state || busy) return;
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const update = modelSettingsUpdate(state);
      for (const service of state.draft.providers) {
        const address = service.baseURL.trim();
        if (address && !URL.canParse(address)) throw new Error(`服务「${service.id.trim() || '新服务'}」的 API 地址不是合法 URL。`);
      }
      const pendingKeys = new Map<string, string | null>();
      for (const service of state.draft.providers) {
        if (service.localKey !== undefined) pendingKeys.set(service.id.trim(), service.localKey);
      }
      const saveKey = localKeys?.saveModelKey;
      if (pendingKeys.size && !saveKey) throw new Error('当前服务不支持在桌面保存 API Key。');
      const result = await client.updateModelSettings(update);
      cache.setQueryData(['model-settings'], result);
      void cache.invalidateQueries({ queryKey: ['health'] });
      try {
        for (const service of state.draft.providers) {
          const id = service.id.trim();
          const key = pendingKeys.get(id);
          if (key === undefined || !saveKey) continue;
          // 配置已提交，按解析后的实际地址写入；内置服务留空地址也能保存密钥。
          const addresses = resolvedBaseUrls(id, result.models);
          if (addresses.length === 0) throw new Error(`服务「${id}」没有可绑定 API Key 的请求地址，请填写 API 地址后重试。`);
          for (const address of addresses) await saveKey(id, address, key);
          pendingKeys.delete(id);
        }
        setSaved('已保存，将用于后续推理。');
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '请检查本机凭据存储后重试。';
        setError(`模型服务设置已保存，API Key 保存失败。${message}`);
      } finally {
        // 服务配置已经提交。只保留尚未写入系统存储的密钥，重试以新的 revision 为基线。
        dispatch({ type: 'reset', data: result, pendingKeys });
        void cache.invalidateQueries({ queryKey: ['model-key-status'] });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return <div className="settings-scroll">
      {query.isError ? <div className="error-banner" role="alert">
        <p>无法读取模型设置：{query.error.message}</p>
        <Button variant="secondary" onClick={() => void query.refetch()}>重新加载</Button>
      </div> : <p className="management-empty" role="status">正在读取模型设置…</p>}
    </div>;
  }

  const { draft, base } = state;
  const conflict = query.data && query.data.revision !== base.revision;
  return <>
    <div className="settings-scroll">
      {expanded !== null && <Button variant="link" size="sm" className="settings-detail-back" onClick={() => setExpanded(null)}><Icon name="arrow-left" size="sm" />返回模型服务列表</Button>}
      {conflict && <p className="settings-notice" role="status">服务端配置已更新。当前草稿仍保留；放弃修改可载入新配置，保存时会检查版本冲突。</p>}
      {query.isError && <p className="settings-notice" role="alert">刷新失败，当前显示上次读取的配置。{query.error.message}</p>}
      <fieldset className="settings-form" disabled={busy}>
        <section className="settings-group" hidden={expanded !== null}>
          <h4>推理连接</h4>
          <SettingRow label="默认服务" hint="未指定模型时使用。配置多个服务后，请明确选择默认服务。">
            <NativeSelect aria-label="默认服务" value={draft.defaultProvider} onChange={event => edit({ ...draft, defaultProvider: event.target.value })}>
              <option value="">{draft.providers.length <= 1 ? '自动选择唯一服务' : '请选择默认服务'}</option>
              {draft.providers.filter(service => service.id).map((service, index) => (
                <option value={service.id} key={index}>{service.displayName || service.id}</option>
              ))}
            </NativeSelect>
          </SettingRow>
        </section>
        <section className="settings-group">
          <div className="settings-section-heading">
            <div><h4>模型服务</h4><p className="settings-note">每个服务共用连接地址、协议与凭据，可包含多个模型。</p></div>
            <span className="management-count">{draft.providers.length} 个服务</span>
          </div>
          {draft.providers.length === 0 && <div className="settings-empty">
            <Icon name="spark" size="lg" /><h4>添加第一个模型服务</h4>
            <p>配置连接信息和模型后，即可在对话中选择。</p>
          </div>}
          {draft.providers.map((service, index) => {
            // 选中服务后进入独立详情，其他连接不与当前编辑器同时展开。
            if (expanded !== null && expanded !== index) return null;
            const models = serviceModels(service, base.models);
            const name = service.displayName || service.id || '新模型服务';
            return <section className="provider-card" key={index}>
              <div className="provider-heading">
                <Button variant="ghost" className="provider-toggle" aria-expanded={expanded === index} onClick={() => setExpanded(expanded === index ? null : index)}>
                  <Icon name={expanded === index ? 'chevron-down' : 'chevron-right'} size="sm" />
                  <span>
                    <strong>{name}</strong>
                    <small>{models.length} 个模型 · {service.defaultModel ? `默认 ${service.defaultModel}` : '未指定默认模型'}</small>
                  </span>
                  {draft.defaultProvider === service.id && service.id && <span className="provider-default">默认服务</span>}
                </Button>
                <Button variant="ghost" size="icon-xs" aria-label={`移除模型服务 ${name}`} onClick={() => setRemoving(index)}><Icon name="trash" size="sm" /></Button>
              </div>
              {removing === index && <ConfirmDialog
                title={`移除「${name}」？`}
                description="仅从编辑草稿移除服务及其模型；保存后才更新服务配置。"
                confirmLabel="移除服务"
                onClose={() => setRemoving(null)}
                onConfirm={() => {
                  edit({
                    ...draft,
                    providers: draft.providers.filter((_, position) => position !== index),
                    defaultProvider: draft.defaultProvider === service.id ? '' : draft.defaultProvider,
                  });
                  setExpanded(null);
                  setRemoving(null);
                }}
              />}
              {expanded === index && <div className="provider-editor">
                <h5>连接设置</h5>
                <div className="provider-fields">
                  <label className="settings-field">服务标识
                    <Input value={service.id} placeholder="例如 openai" spellCheck={false} onChange={event => editService(index, { id: event.target.value })} />
                    <small>用于区分连接；内置服务使用其约定标识。</small>
                  </label>
                  <label className="settings-field">显示名称
                    <Input value={service.displayName} placeholder="例如团队模型服务" onChange={event => editService(index, { displayName: event.target.value })} />
                  </label>
                  <label className="settings-field">协议
                    <NativeSelect value={service.api} onChange={event => editService(index, { api: event.target.value })}>
                      <option value="">使用内置服务协议</option>
                      {base.protocols.map(api => <option key={api}>{api}</option>)}
                    </NativeSelect>
                  </label>
                  <label className="settings-field wide">API 地址
                    <Input value={service.baseURL} placeholder="留空使用内置服务地址" spellCheck={false} onChange={event => editService(index, { baseURL: event.target.value })} />
                  </label>
                  {localKeys?.saveModelKey && <ModelApiKeyField
                    service={service}
                    settings={base}
                    onChange={localKey => editService(index, { localKey })}
                  />}
                  {localKeys?.saveModelKey ? (
                    <details className="settings-field wide">
                      <summary>使用环境变量</summary>
                      <label className="settings-field">密钥环境变量
                        <Input value={service.apiKeyEnv} placeholder="OPENAI_API_KEY" spellCheck={false} autoComplete="off" onChange={event => editService(index, { apiKeyEnv: event.target.value })} />
                      </label>
                    </details>
                  ) : (
                    <label className="settings-field wide">密钥环境变量
                      <Input value={service.apiKeyEnv} placeholder="OPENAI_API_KEY" spellCheck={false} autoComplete="off" onChange={event => editService(index, { apiKeyEnv: event.target.value })} />
                      <small>填写服务端的变量名，凭据由服务端读取。</small>
                    </label>
                  )}
                </div>
                <h5>可用模型</h5>
                <ModelEntries service={service} settings={base} onChange={value => editService(index, value)} />
                <label className="settings-field">默认模型
                  <NativeSelect value={service.defaultModel} onChange={event => editService(index, { defaultModel: event.target.value })}>
                    <option value="">使用服务的默认选择</option>
                    {models.filter(model => model.id).map((model, position) => (
                      <option key={position} value={String(model.id)}>{String(model.name || model.id)}</option>
                    ))}
                  </NativeSelect>
                </label>
              </div>}
            </section>;
          })}
          <Button variant="secondary" className="add-provider" hidden={expanded !== null} onClick={() => {
            setExpanded(draft.providers.length);
            edit({ ...draft, providers: [...draft.providers, {
              id: '', displayName: '', api: 'openai-completions', baseURL: '', apiKeyEnv: '', defaultModel: '', extra: {},
            }] });
          }}><Icon name="plus" size="sm" />添加模型服务</Button>
        </section>
      </fieldset>
    </div>
    <SettingsSaveBar dirty={dirty} busy={busy} saved={saved} error={error} onSave={() => void save()} onReset={() => {
      dispatch({ type: 'reset', data: query.data ?? base });
      setError('');
      setSaved('');
      setExpanded(null);
      setRemoving(null);
    }} />
  </>;
}

/** 输入框只保留尚未提交的值，保存后只能查询存在状态。 */
function ModelApiKeyField({ service, settings, onChange }: {
  service: ModelServiceDraft;
  settings: ModelSettings;
  onChange(value: string | null | undefined): void;
}) {
  const id = service.id.trim();
  // 手填地址优先；留空时使用目录解析出的实际地址，内置服务无需重复填写端点。
  const [address] = serviceBaseUrls(service, settings.models);
  const { data: stored } = useQuery({
    queryKey: ['model-key-status', id, address],
    queryFn: async () => address !== undefined && Boolean(await localKeys?.hasModelKey?.(id, address)),
    enabled: Boolean(id) && address !== undefined,
  });
  return (
    <div className="settings-field">
      <label className="settings-field">API Key
        <Input
          type="password"
          value={service.localKey ?? ''}
          placeholder={stored ? '已保存，留空保留' : '粘贴模型服务的 API Key'}
          autoComplete="new-password"
          spellCheck={false}
          onChange={event => onChange(event.target.value || undefined)}
        />
      </label>
      {service.localKey === null ? (
        <Button variant="link" size="sm" onClick={() => onChange(undefined)}>撤销移除密钥</Button>
      ) : stored ? (
        <Button variant="link" size="sm" onClick={() => onChange(null)}>移除已保存密钥</Button>
      ) : (
        <small>保存后由本机系统加密存储。</small>
      )}
    </div>
  );
}

/** 每个模型保留自己的扩展参数；推理能力改变后，已保存目录不能充当新能力的依据。 */
function ModelEntries({ service, settings, onChange }: {
  service: ModelServiceDraft;
  settings: ModelSettings;
  onChange(value: Partial<ModelServiceDraft>): void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const catalog = settings.models;
  const models = serviceModels(service, catalog);

  function update(next: JsonObject[]) {
    const previousDefault = models.findIndex(model => model.id === service.defaultModel);
    const defaultModel = next.some(model => model.id === service.defaultModel)
      ? service.defaultModel
      : previousDefault >= 0 && next.length === models.length ? String(next[previousDefault]?.id ?? '') : '';
    onChange({ defaultModel, extra: { ...service.extra, models: next } });
  }

  return <div className="model-entries">
    {models.length === 0 && <p className="settings-notice" role="status">
      此服务还没有可用模型。使用内置服务标识会自动继承目录模型；自定义服务需要添加模型并填写模型 ID。
    </p>}
    {models.map((model, index) => {
      const known = catalog.find(entry => entry.provider === service.id && entry.id === model.id);
      const originalService = (settings.config.providers as JsonObject)[service.id] as JsonObject | undefined;
      const originalModel = Array.isArray(originalService?.models)
        ? originalService.models.find(item => (item as JsonObject).id === model.id) as JsonObject | undefined
        : undefined;
      const capabilityChanged = model.reasoning !== originalModel?.reasoning
        || JSON.stringify(model.reasoningLevels) !== JSON.stringify(originalModel?.reasoningLevels);
      const levels = model.reasoning === false || capabilityChanged ? [] : known?.reasoningLevels ?? [];
      return <Collapsible
        className="model-entry"
        key={index}
        open={expanded === index}
        onOpenChange={open => setExpanded(open ? index : null)}
      >
        <div className="model-entry-heading">
          <CollapsibleTrigger render={<Button variant="ghost" className="model-entry-toggle" />}>
            <Icon name={expanded === index ? 'chevron-down' : 'chevron-right'} size="xs" />
            <span><span>{String(model.name || model.id || '新模型')}</span><code>{String(model.id || '请填写模型 ID')}</code></span>
          </CollapsibleTrigger>
          <Button variant="ghost" size="icon-xs" aria-label={`移除模型 ${String(model.id || '新模型')}`} disabled={models.length <= 1} title={models.length <= 1 ? '至少保留一个模型' : '移除此模型'} onClick={() => {
            update(models.filter((_, position) => position !== index));
            setExpanded(null);
          }}><Icon name="x" size="sm" /></Button>
        </div>
        <CollapsibleContent className="model-entry-fields">
          {(['id', 'name'] as const).map(key => <label className="settings-field" key={key}>
            {key === 'id' ? '模型 ID' : '显示名称'}
            <Input value={String(model[key] ?? '')} onChange={event => update(models.map((item, position) => position === index ? { ...item, [key]: event.target.value } : item))} />
          </label>)}
          <label className="settings-field">推理能力
            <NativeSelect value={model.reasoning === true ? 'enabled' : model.reasoning === false ? 'disabled' : 'auto'} onChange={event => update(models.map((item, position) => {
              if (position !== index) return item;
              const next = { ...item };
              delete next.defaultReasoning;
              delete next.reasoningLevels;
              if (event.target.value === 'auto') delete next.reasoning;
              else next.reasoning = event.target.value === 'enabled';
              return next;
            }))}>
              <option value="auto">自动识别</option>
              <option value="enabled">支持推理</option>
              <option value="disabled">不支持推理</option>
            </NativeSelect>
          </label>
          <label className="settings-field">默认推理等级
            <NativeSelect disabled={!levels.length} value={String(model.defaultReasoning ?? '')} onChange={event => update(models.map((item, position) => {
              if (position !== index) return item;
              const next = { ...item };
              if (event.target.value) next.defaultReasoning = event.target.value;
              else delete next.defaultReasoning;
              return next;
            }))}>
              <option value="">自动选择</option>
              {levels.map(level => <option key={level} value={level}>{REASONING_LABELS[level]}</option>)}
            </NativeSelect>
          </label>
          <p className="settings-note">新模型或推理能力发生变化时，请先保存，再选择服务返回的推理等级。</p>
        </CollapsibleContent>
      </Collapsible>;
    })}
    <Button variant="secondary" onClick={() => {
      setExpanded(models.length);
      update([...models, { id: '', name: '' }]);
    }}><Icon name="plus" size="sm" />添加模型</Button>
  </div>;
}
