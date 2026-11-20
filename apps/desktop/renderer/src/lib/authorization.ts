/** 执行配置通过 Runtime 串行提交；界面不重新实现准入规则。 */
import type { WorkspaceAccess } from '../store/preferences';
import { client } from './api';
export interface AuthorizationConfirmation {
  turnId: string;
  expectedRevision: number;
  pendingEffectId: string | null;
  approveCurrentCommand: boolean;
}

export async function configureAuthorization(agentId: string, workspaceAccess: WorkspaceAccess | 'custom', commandAuthorization?: import('@archer/contracts').ConfigureExecutionInput['commandAuthorization'], confirmation?: AuthorizationConfirmation) {
  const state = await client.agentState(agentId);
  if (!state) throw new Error('会话不存在');
  if (commandAuthorization && state.activeTurnId !== commandAuthorization.turnId) throw new Error('当前任务已改变，请重新选择授权');
  if (confirmation && (state.activeTurnId !== confirmation.turnId
    || state.executionRevision !== confirmation.expectedRevision
    || (state.activeTurn?.pending?.effectId ?? null) !== confirmation.pendingEffectId)) {
    throw new Error('任务、等待项或配置已改变，请重新确认完全访问');
  }
  if (confirmation && commandAuthorization) {
    commandAuthorization = { ...commandAuthorization, expectedPendingEffectId: confirmation.pendingEffectId };
    if (confirmation.approveCurrentCommand) {
      if (!confirmation.pendingEffectId || state.activeTurn?.pending?.kind !== 'human'
        || state.activeTurn.pending.purpose !== 'command') throw new Error('当前命令授权已改变，请重新确认');
      const target = { turnId: confirmation.turnId, effectId: confirmation.pendingEffectId };
      const credential = await client.issueHumanToken(agentId, target);
      commandAuthorization.approveCommand = { effectId: target.effectId, token: credential.token };
    }
  }
  if (commandAuthorization || workspaceAccess !== 'custom' && workspaceAccess !== state.workspace?.access) {
    await client.configureExecution(agentId, { expectedRevision: state.executionRevision,
      ...(workspaceAccess === 'custom' ? {} : { workspaceAccess }), ...(commandAuthorization ? { commandAuthorization } : {}) });
  }
}
