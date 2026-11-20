/**
 * 工作区 Git 只读路由。
 *
 * 仓库路径只取会话自己记录的工作区，不接受请求参数指定任意目录。
 */

import type { FastifyInstance } from 'fastify';
import { ArcherError, type Archer } from '@archer/contracts';
import { readWorkspaceGitChanges } from '../workspace-git.js';
import type { AuthHook } from '../auth.js';

export interface WorkspaceGitRoutesOptions {
  archer: Archer;
  auth: AuthHook;
}

export function registerWorkspaceGitRoute(app: FastifyInstance, options: WorkspaceGitRoutesOptions): void {
  app.get('/api/agents/:agentId/workspace/git-changes', { preHandler: options.auth }, async request => {
    const { agentId } = request.params as { agentId: string };
    const agent = await options.archer.agents.get(agentId);
    if (!agent) throw new ArcherError('NOT_FOUND', `Agent 不存在：${agentId}`, { agentId });
    const state = await agent.getState();
    const query = request.query as { scope?: string; path?: string };
    const scope = query.scope ?? 'all';
    if (!['all', 'staged', 'unstaged'].includes(scope)) {
      throw new ArcherError('INVALID_ARGUMENT', '非法 Git 比较范围');
    }
    return readWorkspaceGitChanges(state.workspace?.cwd, scope as 'all' | 'staged' | 'unstaged', query.path);
  });
}
