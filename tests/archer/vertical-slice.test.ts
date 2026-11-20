/** 会话串行、队列、请求幂等和推理预算保持统一事实边界。 */
import { afterEach, expect, it } from 'vitest';
import type { Archer, Inference } from '@archer/contracts';
import { createArcher } from '@archer/runtime';
import { testCamp } from '../helpers/application';
import { toolReply } from '../helpers/inference';
const running: Archer[] = [];
afterEach(async () => { for (const app of running.splice(0)) await app.stop(); });
async function fixture(inference?: Inference) {
  const app = createArcher({ camp: testCamp({ inference }) }); running.push(app); await app.start();
  return { app, agent: await app.agents.create({ id: 'agent', instructions: 'Answer.' }) };
}
it('相同请求幂等、声明不同冲突，并且跨 Turn 保存消息', async () => {
  const { app, agent } = await fixture();
  const first = await agent.send('Hello.', { requestId: 'one' }); await agent.wait(first.turnId);
  expect(await agent.send('Hello.', { requestId: 'one' })).toEqual(first);
  await expect(agent.send('Other.', { requestId: 'one' })).rejects.toMatchObject({ code: 'CONFLICT' });
  expect((await app.agents.create({ id: 'agent', instructions: 'Answer.' })).id).toBe(agent.id);
  await expect(app.agents.create({ id: 'agent', instructions: 'Different.' })).rejects.toMatchObject({ code: 'CONFLICT' });
  await agent.prompt('Second.'); expect((await agent.getState()).messages.filter(message => message.role === 'user')).toHaveLength(2);
});
it('followUp 排队，当前 Turn 收束后顺序消费', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
  const { agent } = await fixture({ infer: async () => { if (calls++ === 0) await gate; return { content: 'Done.' }; } });
  const first = await agent.send('One.'); await agent.followUp('Two.', { requestId: 'queued' });
  expect((await agent.getState()).queuedInputs).toHaveLength(1);
  release(); await agent.wait(first.turnId);
  await expect.poll(async () => (await agent.turns.list()).filter(turn => turn.status === 'completed').length).toBe(2);
  expect((await agent.getState()).queuedInputs).toHaveLength(0);
});
it('取消在途推理会暂停队列，恢复队列需显式操作', async () => {
  let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; });
  const { agent, app } = await fixture({ infer: async (_effect, signal) => { enter(); await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); return { content: '' }; } });
  const first = await agent.send('One.'); await entered; await agent.followUp('Two.'); await agent.abort();
  await expect(agent.wait(first.turnId)).rejects.toMatchObject({ code: 'TURN_CANCELLED' });
  expect((await agent.getState()).queuePaused).toBe(true); expect((await agent.getState()).queuedInputs).toHaveLength(1);
  await app.agents.clearQueue(agent.id); expect((await agent.getState()).queuedInputs).toHaveLength(0);
});
it('默认允许超过十二轮，显式步数限制仍生效', async () => {
  let calls = 0;
  const { agent } = await fixture({ infer: async effect => ++calls <= 13 ? toolReply(effect, 'files.plan', { action: calls === 1 ? 'create' : 'update', planId: 'work', title: '任务计划', expectedRevision: calls === 1 ? null : calls - 1, steps: [{ text: 'Work', status: 'in_progress' }] }) : { content: 'Done.' } });
  await agent.prompt('Work.'); expect(calls).toBe(14);
  calls = 0; await expect(agent.prompt('Limited.', { limits: { maxInferenceSteps: 2 } })).rejects.toMatchObject({ code: 'TURN_FAILED' }); expect(calls).toBe(2);
});

it('图片输入在提交、推理和后续 Turn 历史中完整保留', async () => {
  const image = { type: 'image' as const, mediaType: 'image/png' as const, data: 'aGVsbG8=' };
  const observed: unknown[] = [];
  const { agent } = await fixture({ infer: async effect => {
    observed.push(effect.messages.filter(message => message.images?.length));
    return { content: '看到了图片。' };
  } });
  await agent.prompt({ content: [image] }, { requestId: 'image-request' });
  await agent.prompt('继续解释');
  expect(observed).toEqual([
    [{ role: 'user', content: '', images: [image] }],
    [{ role: 'user', content: '', images: [image] }],
  ]);
  expect((await agent.getState()).messages.find(message => message.images?.length))
    .toEqual({ role: 'user', content: '', images: [image] });
});
