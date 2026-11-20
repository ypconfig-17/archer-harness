import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Archer, AgentJournal, InferEffect, InferResult, Inference } from '@archer/contracts';
import { createArcher } from '@archer/runtime';
import { JsonlAgentJournal, MemoryAgentJournal } from '@archer/storage';
import { testCamp } from '../helpers/application';

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

class FixedInference implements Inference {
  constructor(private readonly content: string) {}
  async infer(_effect: InferEffect, _signal: AbortSignal): Promise<InferResult> {
    return { content: this.content };
  }
}

function memoryStorage(): AgentJournal {
  return new MemoryAgentJournal();
}

async function startedArcher(storage: AgentJournal, content = 'ok'): Promise<Archer> {
  const archer = createArcher({
    camp: testCamp({ journal: storage,
      inference: new FixedInference(content),
    }),
  });
  await archer.start();
  cleanups.push(() => archer.stop());
  return archer;
}

describe('会话标题', () => {
  it('重命名写入会话事实并同步到快照与摘要', async () => {
    const archer = await startedArcher(memoryStorage());
    const agent = await archer.agents.create({ id: 'titled', instructions: 'Answer.' });
    await agent.prompt('第一条消息');

    await archer.agents.rename('titled', { title: '  发布计划  ' });

    expect((await agent.getState()).title).toBe('发布计划');
    expect((await archer.agents.list()).find(item => item.id === 'titled')?.title).toBe('发布计划');
    expect((await agent.events()).some(event => event.fact.event.type === 'agent.renamed')).toBe(true);
  });

  it('标题覆盖首条输入并在重启回放后保留', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archer-title-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const storage = (): AgentJournal => new JsonlAgentJournal(join(dir, 'agents'));

    const first = await startedArcher(storage());
    const agent = await first.agents.create({ id: 'persisted-title', instructions: 'Answer.' });
    await agent.prompt('旧标题来源');
    await first.agents.rename('persisted-title', { title: '新标题' });
    await first.stop();

    const second = await startedArcher(storage());
    const restored = await second.agents.get('persisted-title');
    expect((await restored!.getState()).title).toBe('新标题');
    expect((await second.agents.list()).find(item => item.id === 'persisted-title')?.title).toBe('新标题');
  });

  it('拒绝空白或超长标题', async () => {
    const archer = await startedArcher(memoryStorage());
    await archer.agents.create({ id: 'invalid-title', instructions: 'Answer.' });

    await expect(archer.agents.rename('invalid-title', { title: '   ' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(archer.agents.rename('invalid-title', { title: 'x'.repeat(201) })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(archer.agents.rename('missing', { title: '标题' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('会话摘要的最近活动时间', () => {
  it('取自最后一条已提交事实，并在重启回放后保持一致', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archer-activity-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const storage = (): AgentJournal => new JsonlAgentJournal(join(dir, 'agents'));

    const first = await startedArcher(storage());
    const agent = await first.agents.create({ id: 'persisted-activity', instructions: 'Answer.' });
    await agent.prompt('继续');
    const expected = (await agent.events()).at(-1)!.ts;
    await first.stop();

    const second = await startedArcher(storage());
    const summary = (await second.agents.list()).find(item => item.id === 'persisted-activity')!;
    expect(summary.updatedAt).toBe(expected);
    expect(summary.updatedAt).toBeGreaterThanOrEqual(summary.createdAt);
    const restored = (await second.agents.get('persisted-activity'))!;
    expect((await restored.getState()).updatedAt).toBe(expected);
  });
});

describe('任务索引', () => {
  it('TurnSnapshot 暴露创建事件的 Agent 序号与时间，并支持向前分页', async () => {
    const archer = await startedArcher(memoryStorage());
    const agent = await archer.agents.create({ id: 'turn-index', instructions: 'Answer.' });
    await agent.prompt('第一项');
    await agent.prompt('第二项');
    await agent.prompt('第三项');

    const turns = await agent.turns.list({ limit: 10 });
    expect(turns).toHaveLength(3);
    expect(turns[0]!.agentSeq).toBeGreaterThan(turns[1]!.agentSeq);
    const all = await agent.events();
    for (const turn of turns) {
      const created = all.find(event =>
        event.fact.scope === 'turn'
        && event.fact.event.type === 'turn.created'
        && event.fact.event.data.turnId === turn.turnId)!;
      expect(created.seq).toBe(turn.agentSeq);
      if (created.fact.scope !== 'turn' || created.fact.event.type !== 'turn.created') throw new Error('未找到 Turn 创建事实');
      expect(created.fact.event.data.createdAt).toBe(turn.createdAt);
    }

    const older = await agent.turns.list({ beforeAgentSeq: turns[1]!.agentSeq, limit: 10 });
    expect(older.map(turn => turn.turnId)).toEqual([turns[2]!.turnId]);
  });
});

describe('事件分页窗口', () => {
  async function seeded(): Promise<{ agent: Awaited<ReturnType<Archer['agents']['create']>>; turnId: string }> {
    const archer = await startedArcher(memoryStorage());
    const agent = await archer.agents.create({ id: 'paging', instructions: 'Read.' });
    await agent.prompt('读取内存');
    const turnId = (await agent.turns.list())[0]!.turnId;
    return { agent, turnId };
  }

  it('afterSeq 返回严格大于游标的最近一页', async () => {
    const { agent } = await seeded();
    const all = await agent.events();
    expect(all.length).toBeGreaterThan(4);

    const page = await agent.events({ afterSeq: all[1]!.seq, limit: 2 });
    expect(page.map(event => event.seq)).toEqual(all.slice(2, 4).map(event => event.seq));
    expect((await agent.events({ afterSeq: all.at(-1)!.seq })).length).toBe(0);
  });

  it('beforeSeq 返回严格小于游标的最近一页并保持升序', async () => {
    const { agent, turnId } = await seeded();
    const all = await agent.events();
    const cursor = all.at(-1)!.seq + 1;

    const page = await agent.events({ beforeSeq: cursor, limit: 3 });
    expect(page.map(event => event.seq)).toEqual(all.slice(-3).map(event => event.seq));
    expect(await agent.events({ beforeSeq: 1 })).toEqual([]);

    const turnEvents = await agent.turns.events(turnId, { beforeSeq: Number.MAX_SAFE_INTEGER, limit: 2 });
    expect(turnEvents).toHaveLength(2);
    expect(turnEvents[0]!.seq).toBeLessThan(turnEvents[1]!.seq);
    expect((await agent.turns.events(turnId, { afterSeq: turnEvents[1]!.seq })).length).toBe(0);
  });

  it('拒绝互斥游标与非正历史游标', async () => {
    const { agent } = await seeded();
    await expect(agent.events({ afterSeq: 1, beforeSeq: 5 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(agent.events({ beforeSeq: 0 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(agent.turns.events('missing', { beforeSeq: 5 })).resolves.toEqual([]);
  });
});
