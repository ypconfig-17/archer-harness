import { beforeEach, describe, expect, it } from 'vitest';
import type { ContextProfile } from '@archer/contracts';
import { useSubmissions, type Submission } from '../../../apps/desktop/renderer/src/store/submissions';

beforeEach(() => useSubmissions.setState({ messages: {}, creations: {} }));
describe('未确认提交的页面内保留', () => {
  it('切换 Agent 后保留原始请求身份、内容和模型，确认后只清理对应请求', () => {
    const request: Submission = { mode: 'send', input: '原始任务', requestId: 'request-a', allowShell: false, inference: { provider: 'mock', model: 'mock' } };
    useSubmissions.getState().setMessage('a', request);
    useSubmissions.getState().setMessage('b', { ...request, requestId: 'request-b' });
    expect(useSubmissions.getState().messages.a).toEqual(request);
    useSubmissions.getState().setMessage('b', null);
    expect(useSubmissions.getState().messages.a).toEqual(request);
    expect(useSubmissions.getState().messages.b).toBeUndefined();
  });
  it('各工作区独立保留新会话的未确认请求', () => {
    const request = { id: 'agent-a', requestId: 'request-a', input: '任务', workspaceAccess: 'read' as const, allowShell: false };
    useSubmissions.getState().setCreation('/a', request);
    useSubmissions.getState().setCreation('/b', { ...request, id: 'agent-b' });
    useSubmissions.getState().setCreation('/b', null);
    expect(useSubmissions.getState().creations['/a']).toEqual(request);
    expect(useSubmissions.getState().creations['/b']).toBeUndefined();
  });
});

it('提交快照独立于后续修改的本机默认值，重试保留预算和策略', async () => {
  const { taskOptions } = await import('../../../apps/desktop/renderer/src/lib/task-options');
  const profile: ContextProfile = {
    version: 1, id: 'custom-a', name: '快照配置', description: '', revision: 1,
    steps: [{ kind: 'compact', id: 'compact-1', enabled: true, params: { reserveTokens: 0, growthTokens: 60_000, keepRecentTokens: 4_000, summaryBudgetTokens: 0 } }],
  };
  const prefs = { model: '', reasoningByModel: {}, activeContextProfileId: 'custom-a', customContextProfiles: [profile], tokenBudget: 50_000 };
  const options = taskOptions(prefs);
  useSubmissions.getState().setMessage('a', { mode: 'send', input: 'task', requestId: 'fixed', allowShell: false, ...options });
  // 提交后页面继续编辑：快照中的 Profile 与预算不受影响。
  profile.steps[0]!.enabled = false;
  prefs.activeContextProfileId = 'balanced'; prefs.tokenBudget = 100;
  const stored = useSubmissions.getState().messages.a!;
  expect(stored).toMatchObject({ inference: { contextProfile: { id: 'custom-a', name: '快照配置' } }, limits: { tokenBudget: 50_000 } });
  expect(stored.inference!.contextProfile!.steps[0]!.enabled).toBe(true);
  expect(stored.inference!.contextProfile).not.toBe(prefs.customContextProfiles[0]);
  expect(taskOptions({ ...prefs, tokenBudget: null }).limits).toBeUndefined();
});
