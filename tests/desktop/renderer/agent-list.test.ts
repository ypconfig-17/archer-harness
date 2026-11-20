import { describe, expect, it } from 'vitest';
import type { AgentSummary, Snapshot } from '@archer/contracts';
import { loadAgentList } from '../../../apps/desktop/renderer/src/lib/agent-list';

describe('侧栏完整会话列表', () => {
  const agents: Snapshot<AgentSummary>[] = Array.from({ length: 123 }, (_, index) => ({
    id: `chat-${String(index).padStart(3, '0')}`,
    createdAt: index,
    updatedAt: index,
    seq: 1,
    activeTurnId: null,
    queuePaused: false,
  }));

  it('遵循实际返回的游标读完所有页，再按最近活动展示会话', async () => {
    const cursors: Array<string | undefined> = [];
    const controller = new AbortController();
    const result = await loadAgentList(async (input, options) => {
      expect(options.signal).toBe(controller.signal);
      cursors.push(input.afterId);
      return agents.filter(agent => !input.afterId || agent.id > input.afterId).slice(0, 50);
    }, controller.signal);
    expect(cursors).toEqual([undefined, 'chat-049', 'chat-099', 'chat-122']);
    expect(result).toHaveLength(123);
    expect(result[0]?.id).toBe('chat-122');
    expect(result.at(-1)?.id).toBe('chat-000');
  });

  it('最近发生过新事实的旧会话优先于更晚创建的静默会话', async () => {
    const result = await loadAgentList(async input => input.afterId ? [] : [
      { id: 'older', createdAt: 1, updatedAt: 30, seq: 4, activeTurnId: null, queuePaused: false },
      { id: 'newer', createdAt: 20, updatedAt: 20, seq: 1, activeTurnId: null, queuePaused: false },
    ]);
    expect(result.map(agent => agent.id)).toEqual(['older', 'newer']);
  });

  it('后续页读取失败时拒绝整次更新，不返回会覆盖已有列表的部分结果', async () => {
    await expect(loadAgentList(async input => {
      if (input.afterId) throw new Error('offline');
      return agents.slice(0, 100);
    })).rejects.toThrow('offline');
  });

  it('拒绝不前进的分页游标，避免无限读取', async () => {
    await expect(loadAgentList(async () => agents.slice(0, 1))).rejects.toThrow('分页游标未前进');
  });
});
