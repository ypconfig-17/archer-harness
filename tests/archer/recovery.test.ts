/** JSONL 恢复只读取已提交事实，固定来源缺失时不能替换实现。 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { Archer, Inference, Provider } from '@archer/contracts';
import { createArcher } from '@archer/runtime';
import { ArcherClient } from '@archer/client';
import { buildServer } from '../../apps/server/src/app';
import { provider, tool } from '@archer/camp';
import { JsonlAgentJournal } from '@archer/storage';
import { testCamp } from '../helpers/application';
import { toolReply } from '../helpers/inference';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
async function directory() { const dir = await mkdtemp(join(tmpdir(), 'archer-recovery-')); cleanup.push(() => rm(dir, { recursive: true, force: true })); return dir; }
async function appAt(dir: string, inference: Inference, providers: Provider[] = [], onError?: (error: unknown) => void): Promise<Archer> {
  const app = createArcher({ camp: testCamp({ journal: new JsonlAgentJournal(dir), inference, providers }), onError });
  cleanup.push(() => app.stop()); await app.start(); return app;
}
const aborted = (signal: AbortSignal) => new Promise<never>((_, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
it('started INFER 重启后记录未知并安全重试，恢复相同固定目标', async () => {
  const dir = await directory(); let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; });
  const first = await appAt(dir, { infer: async (_effect, signal) => { enter(); return aborted(signal); } });
  const agent = await first.agents.create({ id: 'infer', instructions: 'Reply.' }); const turn = await agent.send('Hello.'); await entered; await first.stop();
  const infer = vi.fn(async () => ({ content: 'Recovered.' })); const second = await appAt(dir, { infer });
  const restored = (await second.agents.get(agent.id))!; await restored.wait(turn.turnId); expect(infer).toHaveBeenCalledOnce();
  const events = await restored.turns.events(turn.turnId); expect(events.some(event => event.type === 'effect.unknown')).toBe(true);
  expect(events.filter(event => event.type === 'effect.started').map(event => event.type === 'effect.started' && event.data.attempt)).toEqual([1, 2]);
});
it('started 写入重启进入人工对账，即使同名能力已更换来源也不会调用新实现', async () => {
  const dir = await directory(); let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; });
  const source = (version: number, invoke: (input: unknown, context: { signal: AbortSignal }) => Promise<unknown>) => provider('external', { write: tool({ description: 'Write.', execution: 'write', inputSchema: { type: 'object' }, invoke: invoke as never }) }, { identity: { version } });
  const inference: Inference = { infer: async effect => effect.messages.at(-1)?.role === 'tool' ? { content: 'Done.' } : toolReply(effect, 'external.write') };
  const first = await appAt(dir, inference, [source(1, async (_input, context) => { enter(); return aborted(context.signal); })]);
  const agent = await first.agents.create({ id: 'write', instructions: 'Write.' }); const turn = await agent.send('Write.'); await entered; await first.stop();
  const replacement = vi.fn(async () => 'replacement'); const second = await appAt(dir, inference, [source(2, replacement)]);
  const restored = (await second.agents.get(agent.id))!;
  expect((await restored.getState()).activeTurn?.pending?.kind).toBe('reconcile'); expect(replacement).not.toHaveBeenCalled();
  const pending = (await restored.getState()).activeTurn!.pending!;
  await second.agents.reconcile(agent.id, { turnId: turn.turnId, effectId: pending.effectId, decision: { kind: 'retry' } });
  await expect.poll(async () => (await restored.getState()).execution).toBe('blocked'); expect(replacement).not.toHaveBeenCalled();
});
it('已提交成功的写入和多轮聊天在重启后可读取，不能再次执行', async () => {
  const dir = await directory(); const invoke = vi.fn(async () => 'saved');
  const source = provider('external', { write: tool({ description: 'Write.', execution: 'write', inputSchema: { type: 'object' }, invoke }) });
  const inference: Inference = { infer: async effect => effect.messages.some(message => message.role === 'tool') ? { content: 'Done.' } : toolReply(effect, 'external.write') };
  const first = await appAt(dir, inference, [source]); const agent = await first.agents.create({ id: 'complete', instructions: 'Work.' });
  await agent.prompt('One.'); await agent.prompt('Two.'); await first.stop();
  const second = await appAt(dir, inference, [source]); const restored = (await second.agents.get(agent.id))!;
  expect((await restored.turns.list())).toHaveLength(2); expect((await restored.getState()).messages.filter(message => message.role === 'user')).toHaveLength(2); expect(invoke).toHaveBeenCalledOnce();
});
it('日志损坏单独隔离并报告，不改写数据，也不阻止正常会话恢复', async () => {
  const dir = await directory(); const first = await appAt(dir, { infer: async () => ({ content: 'Done.' }) });
  await (await first.agents.create({ id: 'good', instructions: 'Reply.' })).prompt('Hello.'); await first.stop();
  const broken = join(dir, 'broken.jsonl'); const bytes = 'corrupted journal\n'; await writeFile(broken, bytes);
  const errors: unknown[] = []; const second = await appAt(dir, { infer: async () => ({ content: 'Done.' }) }, [], error => { errors.push(error); });
  await expect(second.agents.get('broken')).rejects.toMatchObject({ code: 'EVENT_LOG_CORRUPT', details: { agentId: 'broken', recovery: true } });
  await expect(second.agents.remove('broken')).rejects.toMatchObject({ code: 'EVENT_LOG_CORRUPT' });
  await expect(second.agents.create({ id: 'broken', instructions: 'Reply.' })).rejects.toMatchObject({ code: 'EVENT_LOG_CORRUPT' });
  expect(await second.agents.get('missing')).toBeNull();
  expect(await second.agents.get('good')).not.toBeNull(); expect(errors.length).toBeGreaterThan(0); expect(await readFile(broken, 'utf8')).toBe(bytes);
});

it('缺少能力格式声明的日志明确隔离，不能补造来源或当作不存在', async () => {
  const dir = await directory();
  const first = await appAt(dir, { infer: async () => ({ content: 'Done.' }) });
  await first.agents.create({ id: 'incompatible', instructions: 'Reply.' });
  await first.stop();
  const file = join(dir, 'incompatible.jsonl');
  const batches = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  delete batches[0][0].fact.event.data.capabilityFormat;
  const bytes = batches.map(batch => JSON.stringify(batch)).join('\n') + '\n';
  await writeFile(file, bytes);
  const infer = vi.fn(async () => ({ content: 'Done.' }));
  const second = await appAt(dir, { infer });
  await expect(second.agents.get('incompatible')).rejects.toMatchObject({
    code: 'EVENT_LOG_CORRUPT', message: expect.stringContaining('capabilityFormat'),
    details: { recovery: true, agentId: 'incompatible', cause: expect.stringContaining('第 1 行') },
  });
  expect(await second.agents.list()).toEqual([]);
  expect(await readFile(file, 'utf8')).toBe(bytes);
  expect(infer).not.toHaveBeenCalled();
});

it('重启后从已提交推理用量恢复预算，不因进程重建再次推理', async () => {
  const dir = await directory(); let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; });
  let reading = true; let inferences = 0;
  const source = provider('external', { read: tool({ description: 'Read.', execution: 'read', inputSchema: { type: 'object' }, invoke: async (_input, context) => {
    if (reading) { enter(); return aborted(context.signal); }
    return 'observed';
  } }) });
  const inference: Inference = { infer: async effect => { inferences++; return { ...toolReply(effect, 'external.read'), usage: { promptTokens: 90, completionTokens: 10 } }; } };
  const first = await appAt(dir, inference, [source]);
  const agent = await first.agents.create({ id: 'budget', instructions: 'Read.' });
  const turn = await agent.send('Read.', { limits: { tokenBudget: 100 } });
  await entered; await first.stop(); reading = false;
  const second = await appAt(dir, inference, [source]);
  const restored = (await second.agents.get(agent.id))!;
  const pending = (await restored.getState()).activeTurn!.pending!;
  expect(pending.kind).toBe('reconcile');
  await second.agents.reconcile(agent.id, { turnId: turn.turnId, effectId: pending.effectId, decision: { kind: 'retry' } });
  await expect(restored.wait(turn.turnId)).rejects.toMatchObject({ code: 'TURN_FAILED' });
  expect(inferences).toBe(1);
  expect((await restored.turns.events(turn.turnId)).at(-1)).toMatchObject({ type: 'turn.failed', data: { error: { code: 'TOKEN_BUDGET_EXCEEDED' } } });
});

it('HTTP 客户端保留隔离诊断，只有不存在的会话返回 null，诊断受鉴权保护', async () => {
  const dir = await directory();
  await writeFile(join(dir, 'broken.jsonl'), 'invalid journal\n');
  const archer = await appAt(dir, { infer: async () => ({ content: 'Done.' }) });
  const server = await buildServer({ archer, token: 'admin' });
  try {
    expect((await server.inject({ method: 'GET', url: '/api/agents/broken' })).statusCode).toBe(401);
    const address = await server.listen({ host: '127.0.0.1', port: 0 });
    const client = new ArcherClient({ baseUrl: address, token: 'admin' });
    await expect(client.agentState('broken')).rejects.toMatchObject({
      status: 500, code: 'EVENT_LOG_CORRUPT', message: expect.stringContaining('无法解析 JSON 行'),
    });
    expect(await client.agentState('missing')).toBeNull();
  } finally {
    server.server.closeAllConnections();
    await server.close();
  }
});
