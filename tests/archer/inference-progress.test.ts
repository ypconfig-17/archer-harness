import { channel } from 'node:diagnostics_channel';
import { testCamp } from '../helpers/application';
/** 临时推理通道与事实日志分离：提交开始后才观察，重连无日志游标，断流不执行副作用。 */
import { expect, it } from 'vitest';
import type { InferenceChunk } from '@archer/contracts';
import { createArcher } from '@archer/runtime';
import { ArcherClient } from '@archer/client';
import { MemoryAgentJournal } from '@archer/storage';
import { buildServer } from '../../apps/server/src/app';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
it('通过真实 HTTP 在推理结束前显示进度，最终结果成为唯一正式消息', async () => {
  const journal = new MemoryAgentJournal();
  const finish = deferred();
  const nextChunk = deferred();
  let observedStarted = false;
  const archer = createArcher({
    camp: testCamp({ journal,
      inference: {
    infer: async (_effect, _signal, progress) => {
      observedStarted = (await journal.read('streaming')).some(event => event.fact.scope === 'turn' && event.fact.event.type === 'effect.started');
      progress?.({ content: '{"message":"Hello', reasoning: 'Provider reasoning' });
      await nextChunk.promise;
      progress?.({ content: '{"message":"Hello world', reasoning: 'Provider reasoning' });
      await finish.promise;
      return { content: '{"message":"Hello world"}', reasoning: 'Provider reasoning' };
    },
  } }),

  });
  await archer.start();
  const agent = await archer.agents.create({ id: 'streaming', instructions: 'Reply.' });
  const server = await buildServer({ archer, token: 'test-token' });
  const baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  const client = new ArcherClient({ baseUrl, token: 'test-token' });
  const controller = new AbortController();
  const stream = client.watchProgress(agent.id, { signal: controller.signal });
  const observations: unknown[] = [];
  const observe = (message: unknown) => observations.push(message);
  channel('archer.stream').subscribe(observe);
  try {
    const waiting = stream.next();
    const turn = await agent.send('Go');
    const first = await waiting;
    expect(first.value).toMatchObject({ agentId: agent.id, turnId: turn.turnId, phase: 'generating', content: '{"message":"Hello', reasoning: 'Provider reasoning' });
    expect(first.value).not.toHaveProperty('seq');
    expect(observedStarted).toBe(true);
    // 用消费者确认作为栅栏，验证正文能在同一 INFER 未结束时继续到达，避免依赖计时碰运气。
    const second = stream.next();
    nextChunk.resolve();
    expect((await second).value).toMatchObject({ phase: 'generating', content: '{"message":"Hello world' });
    expect(observations).toContainEqual(expect.objectContaining({ stage: 'Request', responseId: expect.any(String) }));
    expect(observations).toContainEqual(expect.objectContaining({ stage: 'Transport', content: 23 }));
    expect(JSON.stringify(observations)).not.toContain('Provider reasoning');
    expect((await agent.getState()).activeTurnId).toBe(turn.turnId);
    expect(JSON.stringify(await journal.read(agent.id))).not.toContain('Provider reasoning');
    finish.resolve();
    await agent.wait(turn.turnId);
    const events = await journal.read(agent.id);
    expect(events.some(event => event.fact.scope === 'turn' && event.fact.event.type === 'effect.completed' && event.fact.event.data.effectType === 'INFER' && event.fact.event.data.result.reasoning === 'Provider reasoning')).toBe(true);
  } finally {
    channel('archer.stream').unsubscribe(observe);
    nextChunk.resolve();
    finish.resolve();
    controller.abort();
    await stream.return(undefined);
    await server.close();
    await archer.stop();
  }
});
it('中断保留临时内容，但不伪造完成事实；恢复不会将临时内容当作正式回复', async () => {
  const journal = new MemoryAgentJournal();
  const ready = deferred();
  const archer = createArcher({
    camp: testCamp({ journal,
      inference: {
    infer: async (_effect, signal, progress) => {
      progress?.({ content: '{"message":"unfinished' });
      ready.resolve();
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      return { content: 'unreachable' };
    },
  } }),

  });
  await archer.start();
  const agent = await archer.agents.create({ id: 'interrupted', instructions: 'Reply.' });
  try {
    const turn = await agent.send('Go');
    await ready.promise;
    await agent.abort();
    await expect(agent.wait(turn.turnId)).rejects.toMatchObject({ code: 'TURN_CANCELLED' });
    const controller = new AbortController();
    const iterator = archer.agents.watchProgress(agent.id, { signal: controller.signal })[Symbol.asyncIterator]();
    const frame = await iterator.next();
    expect(frame.value).toMatchObject({ phase: 'interrupted', content: '{"message":"unfinished' });
    controller.abort();
    await iterator.return?.();
    expect(JSON.stringify(await journal.read(agent.id))).not.toContain('unfinished');
  } finally { await archer.stop(); }
});
it('慢订阅者只接收最新累计帧，不堆积每个 token', async () => {
  let publish!: (chunk: InferenceChunk) => void;
  const ready = deferred();
  const finish = deferred();
  const archer = createArcher({
    camp: testCamp({ journal: new MemoryAgentJournal(),
      inference: {
    infer: async (_effect, _signal, progress) => {
      publish = progress!;
      ready.resolve();
      await finish.promise;
      return { content: '{"message":"done"}' };
    },
  } }),

  });
  await archer.start();
  const agent = await archer.agents.create({ id: 'slow', instructions: 'Reply.' });
  const controller = new AbortController();
  const iterator = archer.agents.watchProgress(agent.id, { signal: controller.signal })[Symbol.asyncIterator]();
  try {
    const next = iterator.next();
    const turn = await agent.send('Go');
    await ready.promise;
    publish({ content: 'first' });
    await next;
    for (let index = 0; index < 100; index++) publish({ content: `frame-${index}` });
    expect((await iterator.next()).value?.content).toBe('frame-99');
    finish.resolve();
    await agent.wait(turn.turnId);
    publish({ content: 'late callback after completion' });
    expect((await iterator.next()).value).toMatchObject({ content: 'frame-99', phase: 'settled' });
  } finally {
    finish.resolve();
    controller.abort();
    await iterator.return?.();
    await archer.stop();
  }
});
