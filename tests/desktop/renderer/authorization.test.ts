/** 界面只发送当前任务和配置修订，不维护第二套能力列表。 */
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ agentState: vi.fn(), configureExecution: vi.fn(), issueHumanToken: vi.fn() }));
vi.mock('../../../apps/desktop/renderer/src/lib/api', () => ({ client: mocks }));
import { configureAuthorization } from '../../../apps/desktop/renderer/src/lib/authorization';
beforeEach(() => { vi.resetAllMocks(); mocks.agentState.mockResolvedValue({ activeTurnId: 't1', workspace: { access: 'edit' }, executionRevision: 7 }); });
it('工作区只读调整独立于 Shell 授权', async () => {
  await configureAuthorization('a', 'read');
  expect(mocks.configureExecution).toHaveBeenCalledWith('a', { expectedRevision: 7, workspaceAccess: 'read' });
});
it('运行中授权携带目标任务与修订', async () => {
  const commandAuthorization = { turnId: 't1', allowShell: true, commandMode: 'full' as const };
  await configureAuthorization('a', 'custom', commandAuthorization);
  expect(mocks.configureExecution).toHaveBeenCalledWith('a', { expectedRevision: 7, commandAuthorization });
});
it('任务已切换时拒绝沿用旧授权', async () => {
  await expect(configureAuthorization('a', 'edit', { turnId: 'old', allowShell: true, commandMode: 'full' })).rejects.toThrow('当前任务已改变');
  expect(mocks.configureExecution).not.toHaveBeenCalled();
});
it('配置没有变化时不提交空更新', async () => {
  await configureAuthorization('a', 'edit');
  expect(mocks.configureExecution).not.toHaveBeenCalled();
});


it('完全访问确认固定原配置和命令，使用合并请求而非单独批准', async () => {
  mocks.agentState.mockResolvedValue({ activeTurnId: 't1', executionRevision: 7,
    activeTurn: { pending: { kind: 'human', purpose: 'command', effectId: 'e1' } } });
  mocks.issueHumanToken.mockResolvedValue({ token: 'secret' });
  await configureAuthorization('a', 'custom', { turnId: 't1', allowShell: true, commandMode: 'full' },
    { turnId: 't1', expectedRevision: 7, pendingEffectId: 'e1', approveCurrentCommand: true });
  expect(mocks.configureExecution).toHaveBeenCalledWith('a', { expectedRevision: 7,
    commandAuthorization: { turnId: 't1', allowShell: true, commandMode: 'full', expectedPendingEffectId: 'e1', approveCommand: { effectId: 'e1', token: 'secret' } } });
});
it('弹窗期间配置变化不签发凭证、不修改授权', async () => {
  await expect(configureAuthorization('a', 'custom', { turnId: 't1', allowShell: true, commandMode: 'full' },
    { turnId: 't1', expectedRevision: 6, pendingEffectId: null, approveCurrentCommand: false })).rejects.toThrow('重新确认');
  expect(mocks.issueHumanToken).not.toHaveBeenCalled();
  expect(mocks.configureExecution).not.toHaveBeenCalled();
});
