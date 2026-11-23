/** 工作区 Git 读取只在打开对应视图时请求；结果不进入会话事实。 */
import { useQuery } from '@tanstack/react-query';
import type { WorkspaceGitChanges } from '@archer/contracts';
import { client } from '../lib/api';

export function useWorkspaceGitChanges(agentId: string, scope: 'all' | 'staged' | 'unstaged' = 'all', path?: string) {
  return useQuery<WorkspaceGitChanges>({
    queryKey: ['workspace-git', agentId, scope, path],
    queryFn: () => client.workspaceGitChanges(agentId, { scope, path }),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });
}
