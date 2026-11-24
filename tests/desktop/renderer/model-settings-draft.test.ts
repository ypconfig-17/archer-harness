/** 设置草稿保护用户编辑与提交版本，序列化保留非表单字段，避免后台刷新或重名条目吞掉数据。 */
import { describe, expect, it } from 'vitest';
import type { ModelSettings } from '@archer/contracts';
import {
  modelDraft,
  modelDraftDirty,
  modelDraftReducer,
  modelSettingsUpdate,
  resolvedBaseUrls,
  serviceBaseUrls,
  serviceModels,
  type ModelDraftState,
} from '../../../apps/desktop/renderer/src/lib/model-settings-draft';

function settings(revision = 'r1'): ModelSettings {
  return {
    revision,
    protocols: ['openai-completions'],
    models: [{ provider: 'team', id: 'model-a', name: '模型 A', baseUrl: 'https://team.test/v1', reasoningLevels: ['off', 'high'], defaultReasoning: 'off' }],
    config: {
      defaultProvider: 'team',
      providers: {
        team: {
          api: 'openai-completions',
          apiKeyEnv: 'TEAM_API_KEY',
          defaultModel: 'model-a',
          models: [{ id: 'model-a', name: '模型 A', contextWindow: 32000, reasoning: true }],
        },
      },
    },
  };
}

function state(): ModelDraftState {
  const base = settings();
  return { base, draft: modelDraft(base) };
}

describe('模型设置草稿', () => {
  it('后台刷新保留未保存编辑及其原始提交版本', () => {
    const initial = state();
    const edited = modelDraftReducer(initial, { type: 'edit', draft: { ...initial.draft, defaultProvider: '' } })!;
    const refreshed = modelDraftReducer(edited, { type: 'received', data: settings('r2') })!;
    expect(modelDraftDirty(refreshed)).toBe(true);
    expect(refreshed.draft.defaultProvider).toBe('');
    expect(modelSettingsUpdate(refreshed).expectedRevision).toBe('r1');
  });

  it('没有编辑时接收新版本；显式放弃时才替换已有草稿', () => {
    const initial = state();
    const updated = modelDraftReducer(initial, { type: 'received', data: settings('r2') })!;
    expect(updated.base.revision).toBe('r2');
    const edited = { ...updated, draft: { ...updated.draft, defaultProvider: '' } };
    const reset = modelDraftReducer(edited, { type: 'reset', data: settings('r3') })!;
    expect(modelDraftDirty(reset)).toBe(false);
    expect(reset.base.revision).toBe('r3');
    expect(reset.draft.defaultProvider).toBe('team');
  });

  it('编辑显示名称不丢失模型参数、凭据引用及原始配置', () => {
    const initial = state();
    initial.draft.providers[0]!.displayName = '团队模型';
    const update = modelSettingsUpdate(initial);
    expect(update.config).toEqual({
      ...initial.base.config,
      providers: {
        team: { ...(initial.base.config.providers as Record<string, object>).team, displayName: '团队模型' },
      },
    });
    expect(initial.base.config).toEqual(settings().config);
  });

  it('本机密钥只参与表单保存状态，配置提交不包含明文，失败后以新版本保留重试', () => {
    const initial = state();
    initial.draft.providers[0]!.localKey = 'test-only-password';
    expect(modelDraftDirty(initial)).toBe(true);
    expect(JSON.stringify(modelSettingsUpdate(initial))).not.toContain('test-only-password');

    const restored = modelDraftReducer(initial, {
      type: 'reset',
      data: settings('r2'),
      pendingKeys: new Map([['team', 'test-only-password']]),
    })!;
    expect(restored.draft.providers[0]!.localKey).toBe('test-only-password');
    expect(modelSettingsUpdate(restored).expectedRevision).toBe('r2');
    const saved = modelDraftReducer(restored, { type: 'reset', data: settings('r2') })!;
    expect(modelDraftDirty(saved)).toBe(false);
    expect(saved.draft.providers[0]).not.toHaveProperty('localKey');
  });

  it('临时重名模型保持独立编辑，保存时明确拒绝重复标识', () => {
    const initial = state();
    const service = initial.draft.providers[0]!;
    service.extra = { ...service.extra, models: [{ id: 'same', name: '第一个' }, { id: 'same', name: '第二个' }] };
    expect(serviceModels(service, initial.base.models).map(model => model.name)).toEqual(['第一个', '第二个']);
    expect(() => modelSettingsUpdate(initial)).toThrow('模型 ID 重复');
  });

  it('仅填写模型 ID 时，省略空的可选显示名称', () => {
    const initial = state();
    initial.draft.providers[0]!.extra = { models: [{ id: 'model-a', name: '' }] };
    const provider = (modelSettingsUpdate(initial).config.providers as Record<string, object>).team;
    expect(provider).toMatchObject({ models: [{ id: 'model-a' }] });
    expect(JSON.stringify(provider)).not.toContain('"name"');
  });

  it('拒绝空模型、重复服务和已失效的默认选择', () => {
    const blank = state();
    blank.draft.providers[0]!.extra = { models: [{ id: '' }] };
    expect(() => modelSettingsUpdate(blank)).toThrow('空白模型 ID');
    const duplicate = state();
    duplicate.draft.providers.push({ ...duplicate.draft.providers[0]! });
    expect(() => modelSettingsUpdate(duplicate)).toThrow('服务标识不能为空或重复');
    const missing = state();
    missing.draft.providers[0]!.defaultModel = 'deleted';
    expect(() => modelSettingsUpdate(missing)).toThrow('默认模型不在模型列表');
  });

  it('内置服务按目录实际地址绑定密钥，手填地址优先生效', () => {
    const base = settings();
    const catalog = [...base.models, {
      provider: 'deepseek', id: 'deepseek-flash', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com',
      reasoningLevels: ['off', 'high'], defaultReasoning: 'off',
    }];
    const builtin = { ...modelDraft(base).providers[0]!, id: 'deepseek', baseURL: '' };
    expect(serviceBaseUrls(builtin, catalog)).toEqual(['https://api.deepseek.com']);
    expect(serviceBaseUrls({ ...builtin, baseURL: ' https://proxy.test/v1 ' }, catalog)).toEqual(['https://proxy.test/v1']);
    expect(serviceBaseUrls({ ...builtin, id: 'unknown' }, catalog)).toEqual([]);
    expect(resolvedBaseUrls('deepseek', base.models)).toEqual([]);
  });

  it('未编辑内置模型目录时保留隐式目录，不把展示结果固化到配置', () => {
    const initial = state();
    initial.draft.providers[0]!.extra = { api: 'openai-completions' };
    expect(serviceModels(initial.draft.providers[0]!, initial.base.models)).toHaveLength(1);
    const profile = (modelSettingsUpdate(initial).config.providers as Record<string, object>).team;
    expect(profile).not.toHaveProperty('models');
  });
});
