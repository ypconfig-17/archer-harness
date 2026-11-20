import { provider, tool } from '@archer/camp';
import { testCamp } from '../helpers/application';
import { toolReply } from '../helpers/inference';
/** 人工命令必须通过当前等待项、凭证与唯一提交边界，恢复不能重放外部写入。 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Agent, Archer } from '@archer/contracts';
import { createArcher } from '@archer/runtime';
import { MemoryAgentJournal } from '@archer/storage';
import { replayAgent } from '@archer/agent';
import { buildServer } from '../../apps/server/src/app';

const running: Archer[] = [];
afterEach(async () => { await Promise.all(running.splice(0).map(archer => archer.stop())); });
async function waitPending(agent: Agent) {
  await expect.poll(async () => (await agent.getState()).activeTurn?.pending?.kind).toMatch(/human|reconcile/);
  const active = (await agent.getState()).activeTurn!;
  if (active.pending?.kind === 'human') expect(active.pending.options).toEqual(['yes', 'no']);
  return { turnId: active.turnId, effectId: active.pending!.effectId };
}
function setup(content: string, clock?: () => number, external?: () => Promise<import('@archer/contracts').JsonValue>) {
  const journal = new MemoryAgentJournal();
  const archer = createArcher({
    camp: testCamp({ journal, providers: external ? [provider('external', { write: tool({ description: 'External operation.', inputSchema: { type: 'object' }, execution: 'write', invoke: external }) })] : [],
      inference: { infer: async effect => {
    if (effect.messages.some(message => message.role === 'tool')) return { content: 'Done' };
    const result = toolReply(effect, content === 'external.write' ? content : 'files.ask', content === 'external.write' ? {} : { reason: 'Continue?', options: ['yes', 'no'] });
    if (content === 'batch') result.toolCalls!.push({ ...toolReply(effect, 'files.plan', { action: 'create', planId: 'work', title: '任务计划', expectedRevision: null, steps: [{ text: 'Complete task', status: 'in_progress' }] }).toolCalls![0]!, id: 'second-call' });
    return result;
  } } }), ...(clock ? { clock } : {})
  });
  running.push(archer);
  return { archer, journal };
}
const ask = 'files.ask';

describe('人工回复', () => {
  it('重签使旧凭证失效，回复只消费一次且明文不入日志', async () => {
    const { archer, journal } = setup(ask);
    await archer.start();
    const agent = await archer.agents.create({ id: 'human', instructions: 'Ask.' });
    const turn = await agent.send('Go');
    const target = await waitPending(agent);
    const old = await archer.agents.issueHumanToken(agent.id, target);
    const token = await archer.agents.issueHumanToken(agent.id, target);
    await expect(archer.agents.reply(agent.id, { ...target, token: old.token, approved: true, response: 'yes' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(archer.agents.reply(agent.id, { ...target, turnId: 'other', token: token.token, approved: true, response: 'yes' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await archer.agents.reply(agent.id, { ...target, token: token.token, approved: true, response: 'no' });
    await agent.wait(turn.turnId);
    await expect(archer.agents.reply(agent.id, { ...target, token: token.token, approved: true, response: 'yes' })).rejects.toMatchObject({ code: 'CONFLICT' });
    const events = await journal.read(agent.id);
    expect(JSON.stringify(events)).not.toContain(token.token);
    expect(JSON.stringify(events)).not.toContain(old.token);
    expect(replayAgent(agent.id, events)?.activeTurnId).toBeNull();
    expect(events.filter(event => event.fact.scope === 'turn' && event.fact.event.type === 'effect.completed' && event.fact.event.data.effectType === 'CALL')).toHaveLength(1);
  });
  it('拒绝人工请求后停止剩余计划，不将拒绝当成执行授权', async () => {
    const { archer } = setup('batch');
    await archer.start();
    const agent = await archer.agents.create({ id: 'deny', instructions: 'Ask.' });
    const turn = await agent.send('Go');
    const target = await waitPending(agent);
    const token = await archer.agents.issueHumanToken(agent.id, target);
    await archer.agents.reply(agent.id, { ...target, token: token.token, approved: false, response: 'Do not proceed' });
    await expect(agent.wait(turn.turnId)).rejects.toMatchObject({ code: 'TURN_FAILED' });
    const events = await agent.turns.events(turn.turnId);
    expect(events.some(event => event.type === 'effect.created' && event.data.effect.type === 'CALL' && event.data.effect.target.providerId + '.' + event.data.effect.target.capabilityId === 'files.plan')).toBe(false);
  });
  it('过期凭证被拒绝，重新签发后可以继续', async () => {
    let now = 1000;
    const { archer } = setup(ask, () => now);
    await archer.start();
    const agent = await archer.agents.create({ id: 'expiry', instructions: 'Ask.' });
    await agent.send('Go');
    const target = await waitPending(agent);
    const token = await archer.agents.issueHumanToken(agent.id, target);
    now = token.expiresAt;
    await expect(archer.agents.reply(agent.id, { ...target, token: token.token, approved: true, response: '' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await agent.getState()).activeTurn?.pending?.kind).toBe('human');
    const fresh = await archer.agents.issueHumanToken(agent.id, target);
    await archer.agents.reply(agent.id, { ...target, token: fresh.token, approved: true, response: '' });
  });
  it('HTTP 人工入口要求鉴权并拒绝非法载荷', async () => {
    const { archer } = setup(ask);
    await archer.start();
    const agent = await archer.agents.create({ id: 'http-human', instructions: 'Ask.' });
    await agent.send('Go');
    const target = await waitPending(agent);
    const server = await buildServer({ archer, token: 'test-token', inference: 'mock' });
    const headers = { authorization: 'Bearer test-token' };
    try {
      expect((await server.inject({ method: 'POST', url: `/api/agents/${agent.id}/human/token`, payload: target })).statusCode).toBe(401);
      const token = await server.inject({ method: 'POST', url: `/api/agents/${agent.id}/human/token`, headers, payload: target });
      expect(token.statusCode).toBe(200);
      expect((await server.inject({ method: 'POST', url: `/api/agents/${agent.id}/human/reply`, headers, payload: { ...target, token: token.json().token, approved: 'yes' } })).statusCode).toBe(400);
      expect((await server.inject({ method: 'POST', url: `/api/agents/${agent.id}/human/reply`, headers, payload: { ...target, token: token.json().token, approved: true, response: 'yes' } })).statusCode).toBe(204);
    } finally { await server.close(); }
  });
});

async function unknownWrite() {
  let calls = 0;
  const { archer, journal } = setup('external.write', undefined, async () => { calls++; if (calls === 1) throw new Error('Connection lost after dispatch'); return { confirmed: true }; });
  await archer.start();
  const agent = await archer.agents.create({ id: 'unknown', instructions: 'Run.' });
  const turn = await agent.send('Go');
  const target = await waitPending(agent);
  return { archer, journal, agent, turn, target, calls: () => calls };
}
describe('未知写入对账', () => {
  it('只有显式 retry 才复用原 Effect 执行，attempt 随 started 递增', async () => {
    const f = await unknownWrite();
    expect(f.calls()).toBe(1);
    await f.archer.agents.reconcile(f.agent.id, { ...f.target, decision: { kind: 'retry' } });
    await f.agent.wait(f.turn.turnId);
    expect(f.calls()).toBe(2);
    const started = (await f.agent.turns.events(f.turn.turnId)).filter(event => event.type === 'effect.started' && event.data.effectId === f.target.effectId);
    expect(started.map(event => event.type === 'effect.started' && event.data.attempt)).toEqual([1, 2]);
  });
  it('abandon 保留 unknown 的执行事实，结束 Turn 且不再次调用节点', async () => {
    const f = await unknownWrite();
    await f.archer.agents.reconcile(f.agent.id, { ...f.target, decision: { kind: 'abandon', reason: 'Cannot establish external status' } });
    expect(f.calls()).toBe(1);
    const state = replayAgent(f.agent.id, await f.journal.read(f.agent.id))!;
    const turn = state.turns.get(f.turn.turnId)!;
    expect(turn.status).toBe('failed');
    expect(turn.effects.at(-1)).toMatchObject({ status: 'unknown', abandoned: { reason: 'Cannot establish external status' } });
    await expect(f.archer.agents.reconcile(f.agent.id, { ...f.target, decision: { kind: 'retry' } })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('取消请求禁止 retry，但允许人工放弃追踪并完成取消', async () => {
    const f = await unknownWrite();
    await f.agent.abort();
    await expect(f.archer.agents.reconcile(f.agent.id, { ...f.target, decision: { kind: 'retry' } })).rejects.toMatchObject({ code: 'CONFLICT' });
    await f.archer.agents.reconcile(f.agent.id, { ...f.target, decision: { kind: 'abandon', reason: 'User stops tracking' } });
    expect((await f.agent.turns.get(f.turn.turnId))?.status).toBe('cancelled');
    expect(f.calls()).toBe(1);
  });
});
