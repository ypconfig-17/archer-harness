/** 计划版本只由已提交结果推进，重启和人工回答不能重放或重置计划。 */
import { afterEach, expect, it } from 'vitest';
import type { Archer, Inference, JsonValue, TaskPlan } from '@archer/contracts';
import { createArcher } from '@archer/runtime';
import { MemoryAgentJournal } from '@archer/storage';
import { replayAgent } from '@archer/agent';
import { committedHistory } from '../../packages/runtime/src/archer/history';
import { testCamp } from '../helpers/application';
import { toolReply } from '../helpers/inference';

const running: Archer[] = [];
afterEach(async () => {
  for (const app of running.splice(0).reverse()) await app.stop();
});
const stage = (text: string, status = 'in_progress') => [{ text, status }];
const create = (planId: string) => ({ action: 'create', planId, title: planId, expectedRevision: null, steps: stage(planId) });
const update = (planId: string, expectedRevision: number, status = 'in_progress') => ({
  action: 'update', planId, title: planId, expectedRevision, steps: stage(planId, status),
});

it('拒绝重复身份、过期修订和并行计划，成功完成后允许下一份独立计划', async () => {
  const journal = new MemoryAgentJournal();
  const declarations = [
    create('a'), create('b'), create('a'), update('a', 9),
    update('a', 1, 'completed'), create('b'), update('a', 2), update('b', 1, 'completed'),
  ];
  const app = createArcher({ camp: testCamp({ journal, inference: {
    infer: async effect => {
      const count = effect.messages.filter(message => message.role === 'tool').length;
      return count < declarations.length ? toolReply(effect, 'files.plan', declarations[count]!) : { content: 'Done.' };
    },
  } }) });
  running.push(app);
  await app.start();
  const agent = await app.agents.create({ id: 'plans', instructions: 'Work.' });
  await agent.prompt('Complete two plans.');
  const state = replayAgent(agent.id, await journal.read(agent.id))!;
  const effects = [...state.turns.values()][0]!.effects.filter(entry => entry.effect.type === 'CALL');
  expect(effects.map(entry => entry.status)).toEqual([
    'completed', 'failed', 'failed', 'failed', 'completed', 'completed', 'failed', 'completed',
  ]);
  expect(effects.filter(entry => entry.status === 'failed').every(entry => entry.error?.code === 'CONFLICT')).toBe(true);
  const plans = effects.filter(entry => entry.status === 'completed').map(entry => (
    entry.result as { value: { metadata: { plan: TaskPlan } } }
  ).value.metadata.plan);
  expect(plans.map(plan => [plan.planId, plan.revision])).toEqual([['a', 1], ['a', 2], ['b', 1], ['b', 2]]);
  const target = effects[0]!.effect;
  if (target.type !== 'CALL') throw new Error('Expected call.');
  const history = committedHistory(state).history;
  const turnId = [...state.turns.keys()][0]!;
  const first = history.list({ turnId, target: target.target, limit: 2 });
  expect(first.calls).toHaveLength(2);
  expect(first.nextOffset).toBe(2);
  expect(history.list({ turnId, target: { ...target.target, revision: 'different' } }).calls).toEqual([]);
  expect(history.list({ turnId: 'other', target: target.target }).calls).toEqual([]);
});

it('重启后回答原询问，从原计划版本继续；后续 Turn 可以使用相同局部身份', async () => {
  const journal = new MemoryAgentJournal();
  const actions: { name: string; input: JsonValue }[] = [
    { name: 'files.plan', input: create('work') },
    { name: 'files.ask', input: { reason: 'Continue?', options: ['yes', 'no'] } },
    { name: 'files.plan', input: update('work', 1, 'completed') },
  ];
  const inference: Inference = { infer: async effect => {
    const lastUser = effect.messages.map(message => message.role).lastIndexOf('user');
    const count = effect.messages.slice(lastUser + 1).filter(message => message.role === 'tool').length;
    const action = actions[count];
    return action ? toolReply(effect, action.name, action.input) : { content: 'Done.' };
  } };
  const start = async () => {
    const app = createArcher({ camp: testCamp({ journal, inference }) });
    running.push(app);
    await app.start();
    return app;
  };
  const first = await start();
  const agent = await first.agents.create({ id: 'restore-plan', instructions: 'Work.' });
  const turn = await agent.send('Work.');
  await expect.poll(async () => (await agent.getState()).activeTurn?.pending?.kind).toBe('human');
  await first.stop();
  const second = await start();
  const restored = (await second.agents.get(agent.id))!;
  const answer = async () => {
    const active = (await restored.getState()).activeTurn!;
    const target = { turnId: active.turnId, effectId: active.pending!.effectId };
    const token = await second.agents.issueHumanToken(agent.id, target);
    await second.agents.reply(agent.id, { ...target, token: token.token, approved: true, response: 'yes' });
    return active.turnId;
  };
  await answer();
  await restored.wait(turn.turnId);
  const next = await restored.send('Again.');
  await expect.poll(async () => (await restored.getState()).activeTurn?.pending?.kind).toBe('human');
  await answer();
  await restored.wait(next.turnId);
  const state = replayAgent(agent.id, await journal.read(agent.id))!;
  expect(state.turns.size).toBe(2);
  for (const current of state.turns.values()) {
    const plans = current.effects.filter(entry => entry.effect.type === 'CALL' && entry.effect.target.capabilityId === 'plan');
    expect(plans).toHaveLength(2);
    expect(plans.map(entry => entry.attempt)).toEqual([1, 1]);
    expect(plans.map(entry => (entry.result as { value: { metadata: { plan: TaskPlan } } }).value.metadata.plan.revision)).toEqual([1, 2]);
  }
});
