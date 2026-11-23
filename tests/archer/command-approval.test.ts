import { provider, tool } from '@archer/camp';
import { testCamp } from '../helpers/application';
import { toolReply } from '../helpers/inference';
/** 命令审批在执行前提交，拒绝不产生外部调用，恢复保留等待事实。 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Agent, Archer, CommandMode } from '@archer/contracts';
import { createArcher } from '@archer/runtime';
import { MemoryAgentJournal } from '@archer/storage';
import { automaticallyApproved } from '../../packages/runtime/src/execution/command-approval';

const running: Archer[] = [];
afterEach(async () => { await Promise.all(running.splice(0).map(a => a.stop())); });
async function setup(command: string, mode: CommandMode | undefined, visible = true) {
  const storage = new MemoryAgentJournal();
  let calls = 0;
  const source = provider('command', { bash: tool({ description: 'Shell.', execution: 'shell', inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] }, invoke: async () => { calls++; return { output: 'done' }; } }) });
  let inferences = 0;
  const inference = { infer: async (effect: import('@archer/contracts').InferEffect) => {
    if (inferences++ > 0) return { content: 'done' };
    if (!effect.tools?.some(tool => tool.target.providerId === 'command')) return { content: '', toolCalls: [{ id: 'unauthorized', name: 'unavailable', input: { command } }] };
    return toolReply(effect, 'command.bash', { command });
  } };

  const archer = createArcher({
    camp: testCamp({ journal: storage, inference, builtins: false, providers: visible ? [source] : [] }),

  });
  running.push(archer); await archer.start();
  const agent = await archer.agents.create({ id: 'approval', instructions: 'Run.',  });
  const turn = await agent.send('Go', { allowShell: true, commandMode: mode, requestId: 'original' });
  return { archer, agent, turn, storage, source, inference, calls: () => calls };
}
async function pending(agent: Agent) {
  await expect.poll(async () => (await agent.getState()).activeTurn?.pending?.kind).toBe('human');
  const turn = (await agent.getState()).activeTurn!;
  expect(turn.pending).toMatchObject({ purpose: 'command' });
  return { turnId: turn.turnId, effectId: turn.pending!.effectId };
}
async function reply(a: Archer, agent: Agent, approved: boolean) {
  const target = await pending(agent);
  const token = await a.agents.issueHumanToken(agent.id, target);
  await a.agents.reply(agent.id, { ...target, token: token.token, approved, response: '' });
  return { ...target, token: token.token, approved, response: '' };
}

describe('三种命令模式', () => {
  it('未指定模式时默认每次询问', async () => {
    const s = await setup('pwd', undefined);
    await pending(s.agent); expect(s.calls()).toBe(0);
  });
  it('取消等待中的命令后，原批准凭证不可再使用', async () => {
    const s = await setup('pwd', 'ask');
    const target = await pending(s.agent);
    const token = await s.archer.agents.issueHumanToken(s.agent.id, target);
    await s.agent.abort({ turnId: target.turnId });
    await expect(s.agent.wait(s.turn.turnId)).rejects.toMatchObject({ code: 'TURN_CANCELLED' });
    await expect(s.archer.agents.reply(s.agent.id, { ...target, token: token.token, approved: true, response: '' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(s.calls()).toBe(0);
  });
  it('同一请求身份不能更换命令模式', async () => {
    const s = await setup('pwd', 'ask');
    await pending(s.agent);
    await expect(s.agent.send('Go', { requestId: 'original', allowShell: true, commandMode: 'full' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('每次询问在确认前不执行，批准后只执行一次，不能重复使用凭证', async () => {
    const s = await setup('pwd', 'ask');
    await pending(s.agent); expect(s.calls()).toBe(0);
    const response = await reply(s.archer, s.agent, true);
    await s.agent.wait(s.turn.turnId); expect(s.calls()).toBe(1);
    await expect(s.archer.agents.reply(s.agent.id, response)).rejects.toMatchObject({ code: 'CONFLICT' });
    const events = await s.agent.turns.events(s.turn.turnId);
    const index = (type: string) => events.findIndex(e => e.type === type && 'effectId' in e.data && e.data.effectId === response.effectId);
    expect(index('effect.created')).toBeLessThan(index('effect.suspended'));
    expect(index('effect.suspended')).toBeLessThan(index('effect.resumed'));
    expect(index('effect.resumed')).toBeLessThan(index('effect.started'));
  });
  it('拒绝后终结任务，节点没有被调用', async () => {
    const s = await setup('touch marker', 'ask');
    await reply(s.archer, s.agent, false);
    await expect(s.agent.wait(s.turn.turnId)).rejects.toMatchObject({ code: 'TURN_FAILED' });
    expect(s.calls()).toBe(0);
  });
  it('自动审批放行固定只读规则，其余命令仍询问', async () => {
    const safe = await setup('/bin/ls -la', 'auto');
    await safe.agent.wait(safe.turn.turnId); expect(safe.calls()).toBe(1);
    const other = await setup('npm test', 'auto');
    await pending(other.agent); expect(other.calls()).toBe(0);
  });
  it('完全访问直接执行，但仍不突破宿主声明的能力集合', async () => {
    const full = await setup('npm test', 'full');
    await full.agent.wait(full.turn.turnId); expect(full.calls()).toBe(1);
    const denied = await setup('npm test', 'full', false);
    await denied.agent.wait(denied.turn.turnId); expect(denied.calls()).toBe(0);
  });
  it('恢复后保留原命令等待，重新签发凭证后才能执行', async () => {
    const s = await setup('pwd', 'ask');
    await pending(s.agent); await s.archer.stop();
    const restored = createArcher({
    camp: testCamp({ journal: s.storage, inference: s.inference, builtins: false, providers: [s.source] }),

  });
    running.push(restored); await restored.start();
    const agent = (await restored.agents.get('approval'))!;
    await pending(agent); expect(s.calls()).toBe(0);
    await reply(restored, agent, true); await agent.wait(s.turn.turnId);
    expect(s.calls()).toBe(1);
  });
});

it.each(['pwd; touch x', 'pwd\ntouch x', 'echo $(touch x)', 'echo `touch x`', 'echo x > file', 'echo $HOME', 'ls', 'git status', '/bin/ls /etc'])('自动审批不猜测复合语法或 PATH 程序：%s', command => {
  expect(automaticallyApproved(command, 'linux')).toBe(false);
});

it('Windows 不套用 POSIX 内建命令规则，保持人工确认', () => {
  expect(automaticallyApproved('pwd', 'win32')).toBe(false);
  expect(automaticallyApproved('/bin/ls', 'win32')).toBe(false);
});
