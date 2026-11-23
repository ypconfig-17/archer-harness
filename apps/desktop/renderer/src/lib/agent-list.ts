import type { AgentListInput, AgentSummary, ReadOptions, Snapshot } from '@archer/contracts';

type ListAgents = (input: AgentListInput, options: ReadOptions) => Promise<readonly Snapshot<AgentSummary>[]>;

/**
 * 按服务端 id 游标读取全部会话，完整读取成功后再替换侧栏列表。
 * 展示次序按最近一条已提交事实排序；创建时间与 id 只用于活动时间相同时的稳定次序。
 */
export async function loadAgentList(list: ListAgents, signal?: AbortSignal): Promise<readonly Snapshot<AgentSummary>[]> {
  const agents: Snapshot<AgentSummary>[] = [];
  let afterId: string | undefined;
  while (true) {
    const page = await list({ limit: 100, ...(afterId ? { afterId } : {}) }, { signal });
    if (page.length === 0) {
      return agents.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    }
    const next = page.at(-1)!.id;
    if (afterId !== undefined && next <= afterId) throw new Error('会话列表分页游标未前进');
    agents.push(...page);
    afterId = next;
  }
}
