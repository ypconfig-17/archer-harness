/** 设置草稿保护用户编辑与提交版本，序列化保留非表单字段，避免后台刷新或重名条目吞掉数据。 */
import { describe, expect, it } from 'vitest';
import type { ModelSettings } from '@archer/contracts';
import {
  modelDraft,
  modelDraftDirty,
  modelDraftReducer,
  modelSettingsUpdate,
  serviceModels,
  type ModelDraftState,
} from '../../../apps/desktop/renderer/src/lib/model-settings-draft';

function settings(revision = 'r1'): ModelSettings {
  return {
    revision,
    mode: 'pi',
    protocols: ['openai-completions'],
    models: [{ provider: 'team', id: 'model-a', name: '模型 A', reasoningLevels: ['off', 'high'], defaultReasoning: 'off' }],
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
    const edited = modelDraftReducer(initial, { type: 'edit', draft: { ...initial.draft, mode: 'mock' } })!;
    const refreshed = modelDraftReducer(edited, { type: 'received', data: settings('r2') })!;
    expect(modelDraftDirty(refreshed)).toBe(true);
    expect(refreshed.draft.mode).toBe('mock');
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

  it('临时重名模型保持独立编辑，保存时明确拒绝重复标识', () => {
    const initial = state();
    const service = initial.draft.providers[0]!;
    service.extra = { ...service.extra, models: [{ id: 'same', name: '第一个' }, { id: 'same', name: '第二个' }] };
    expect(serviceModels(service, initial.base.models).map(model => model.name)).toEqual(['第一个', '第二个']);
    expect(() => modelSettingsUpdate(initial)).toThrow('模型 ID 重复');
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

  it('未编辑内置模型目录时保留隐式目录，不把展示结果固化到配置', () => {
    const initial = state();
    initial.draft.providers[0]!.extra = { api: 'openai-completions' };
    expect(serviceModels(initial.draft.providers[0]!, initial.base.models)).toHaveLength(1);
    const profile = (modelSettingsUpdate(initial).config.providers as Record<string, object>).team;
    expect(profile).not.toHaveProperty('models');
  });
});
