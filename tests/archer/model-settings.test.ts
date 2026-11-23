import { testCamp } from '../helpers/application';
import { toolReply } from '../helpers/inference';
/** 模型配置的保存、凭据边界与任务选择均从对外行为验证。 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { ContextProfile, InferConfig, InferEffect } from '@archer/contracts';
import { createArcher } from '@archer/runtime';
import { MemoryAgentJournal } from '@archer/storage';
import { replayAgent } from '@archer/agent';
import { createModelSettings } from '../../apps/server/src/model-settings.js';
import { buildServer } from '../../apps/server/src/app.js';

it('模型设置保留服务端请求头、校验修订并在重启后恢复，失败不切换配置', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'archer-settings-'));
  try {
    const config = { providers: { local: { api: 'openai-completions', baseURL: 'http://127.0.0.1:9999/v1', apiKeyEnv: 'MODEL_KEY', headers: { 'x-private': 'secret-header' }, models: [{ id: 'small' }], defaultModel: 'small' } } };
    const initial = join(dir, 'ai.json'); await writeFile(initial, JSON.stringify(config));
    const file = join(dir, 'settings.json');
    const service = await createModelSettings(file, initial);
    expect(JSON.stringify(service.get())).not.toContain('secret-header');
    expect(service.get().models).toContainEqual(expect.objectContaining({ provider: 'local', id: 'small' }));
    const request: InferEffect = { type: 'INFER', target: { providerId: 'model', capabilityId: 'infer', contractId: 'archer.inference@1', revision: 'v1' }, promptPrefixCount: 0, messages: [{ role: 'user', content: 'Hello' }] };
    expect(service.inference.measure?.(request)?.contextWindow).toBeGreaterThan(0);
    const before = service.get();
    const updated = await service.update({ expectedRevision: before.revision, mode: 'pi', config: before.config });
    expect(updated.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(file, 'utf8')).toContain('secret-header');
    const mock = await service.update({ expectedRevision: updated.revision, mode: 'mock', config: updated.config });
    expect(service.inference.measure?.(request)).toBeUndefined();
    expect(mock.revision).not.toBe(updated.revision);
    await expect(service.update({ expectedRevision: updated.revision, mode: 'pi', config: updated.config })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(service.update({ expectedRevision: mock.revision, mode: 'pi', config: { providers: {} } })).rejects.toThrow();
    expect(service.get()).toEqual(mock);
    expect((await createModelSettings(file)).get()).toEqual(mock);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('模型设置接口遵循入口鉴权，未授权者不能读取或修改配置', async () => {
  const archer = createArcher({
    camp: testCamp({ journal: new MemoryAgentJournal(),
      inference: { async infer() { return { content: '' }; } } }),

  });
  await archer.start();
  const server = await buildServer({ archer, inference: 'mock', token: 'admin' });
  try {
    const preflight = await server.inject({ method: 'OPTIONS', url: '/api/settings/models', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'PUT' } });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-methods']).toContain('PUT');
    expect((await server.inject({ method: 'GET', url: '/api/settings/models' })).statusCode).toBe(401);
    expect((await server.inject({ method: 'PUT', url: '/api/settings/models', payload: {} })).statusCode).toBe(401);
  } finally { await server.close(); await archer.stop(); }
});

it('每个任务的模型选择和排队选择分别固化，重试不能更换已接受请求的模型', async () => {
  const first: ContextProfile = {
    version: 1, id: 'custom-first', name: '首个配置', description: '', revision: 1,
    steps: [{ kind: 'compact', id: 'compact-1', enabled: false, params: { reserveTokens: 0, growthTokens: 100_000, keepRecentTokens: 20_000, summaryBudgetTokens: 0 } }],
  };
  const second: ContextProfile = {
    ...first, id: 'custom-second', name: '排队配置', revision: 2,
    steps: [{ kind: 'compact', id: 'compact-1', enabled: true, params: { reserveTokens: 0, growthTokens: 100_000, keepRecentTokens: 3_000, summaryBudgetTokens: 0 } }],
  };
  const journal = new MemoryAgentJournal();
  const calls: (InferConfig | undefined)[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const archer = createArcher({
    camp: testCamp({ journal,
      inference: {
    async infer(effect: InferEffect) {
      calls.push(effect.config);
      if (calls.length === 1) await gate;
      const observed = effect.messages.at(-1)?.role === 'tool';
      return observed ? { content: 'done' } : toolReply(effect, 'files.plan', { action: 'create', planId: 'work', title: '任务计划', expectedRevision: null, steps: [{ text: 'Complete task', status: 'in_progress' }] });
    },
  } }),

  });
  await archer.start();
  try {
    const agent = await archer.agents.create({ id: 'model-choice', instructions: 'Finish the task.', inference: { provider: 'default', model: 'original' } });
    const accepted = await agent.send('first', { requestId: 'first', inference: { provider: 'alpha', model: 'one', reasoning: 'low', contextProfile: first } });
    await agent.followUp('second', { requestId: 'second', inference: { provider: 'beta', model: 'two', reasoning: 'high', contextProfile: second } });
    await expect(agent.send('first', { requestId: 'first', inference: { provider: 'alpha', model: 'changed' } })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(agent.send('first', { requestId: 'first', inference: { provider: 'alpha', model: 'one', reasoning: 'max' } })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(agent.send('first', { requestId: 'first', inference: { provider: 'alpha', model: 'one', reasoning: 'low', contextProfile: { ...first, revision: 2 } } })).rejects.toMatchObject({ code: 'CONFLICT' });
    release();
    for await (const event of archer.agents.watch(agent.id, { afterSeq: 0 })) if (event.fact.scope === 'turn' && event.fact.event.type === 'turn.completed' && event.fact.turnId !== accepted.turnId) break;
    // 摘要快照随首个请求固定，工具返回后的后续推理不能更换配置。
    expect(calls).toEqual([
      { provider: 'alpha', model: 'one', reasoning: 'low', contextProfile: first },
      { provider: 'alpha', model: 'one', reasoning: 'low', contextProfile: first },
      { provider: 'beta', model: 'two', reasoning: 'high', contextProfile: second },
      { provider: 'beta', model: 'two', reasoning: 'high', contextProfile: second },
    ]);
    const events = await journal.read(agent.id, 0);
    const replayed = replayAgent(agent.id, events);
    expect([...replayed!.turns.values()].map(turn => turn.inference)).toEqual(calls.filter((_, index) => index % 2 === 0));
  } finally { release(); await archer.stop(); }
});

it('省略任务策略时，默认完整快照写入创建事实并沿用于多轮、排队与重启', async () => {
  const { defaultContextProfile } = await import('@archer/contracts');
  const journal = new MemoryAgentJournal();
  const profiles: unknown[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const inference = {
    async infer(effect: InferEffect) {
      profiles.push(effect.config?.contextProfile);
      if (profiles.length === 1) await gate;
      return effect.messages.at(-1)?.role === 'tool'
        ? { content: 'Done.' }
        : toolReply(effect, 'files.plan', { action: 'create', planId: 'work', title: '任务计划', expectedRevision: null, steps: [{ text: 'Complete task', status: 'in_progress' }] });
    },
  };
  const app = createArcher({ camp: testCamp({ journal, inference }) });
  await app.start();
  try {
    const agent = await app.agents.create({ id: 'default-profile', instructions: 'Reply.' });
    expect((await journal.read(agent.id))[0]!.fact.event).toMatchObject({
      type: 'agent.created', data: { inference: { contextProfile: defaultContextProfile() } },
    });
    const first = await agent.send('First.', { requestId: 'first-default' });
    await agent.followUp('Next.', { requestId: 'queued-default' });
    release();
    for await (const event of app.agents.watch(agent.id, { afterSeq: 0 })) {
      if (event.fact.scope === 'turn' && event.fact.event.type === 'turn.completed' && event.fact.turnId !== first.turnId) break;
    }
    // 重试仍按用户原始提交判等，内部固定默认值不能改变 requestId 的幂等签名。
    expect(await agent.send('First.', { requestId: 'first-default' })).toEqual(first);
    expect(profiles).toEqual(Array.from({ length: 4 }, defaultContextProfile));
  } finally {
    release();
    await app.stop();
  }
  const restored = createArcher({ camp: testCamp({ journal, inference }) });
  await restored.start();
  try {
    const agent = (await restored.agents.get('default-profile'))!;
    await agent.prompt('Continue after restart.');
    const replayed = replayAgent(agent.id, await journal.read(agent.id))!;
    expect(replayed.inference.contextProfile).toEqual(defaultContextProfile());
    for (const turn of replayed.turns.values()) {
      for (const entry of turn.effects) {
        if (entry.effect.type === 'INFER') expect(entry.effect.config?.contextProfile).toEqual(replayed.inference.contextProfile);
      }
    }
    expect(profiles).toEqual(Array.from({ length: 6 }, defaultContextProfile));
  } finally {
    await restored.stop();
  }
});

it('HTTP 和 SDK 都拒绝有歧义的策略链，拒绝时不写入输入或调用模型', async () => {
  const { defaultContextProfile } = await import('@archer/contracts');
  const journal = new MemoryAgentJournal();
  let calls = 0;
  const app = createArcher({ camp: testCamp({ journal, inference: { infer: async () => {
    calls += 1;
    return { content: 'Done.' };
  } } }) });
  await app.start();
  const server = await buildServer({ archer: app, inference: 'mock' });
  try {
    const agent = await app.agents.create({ id: 'invalid-profile', instructions: 'Reply.' });
    const invalid = defaultContextProfile();
    invalid.steps[1]!.id = invalid.steps[0]!.id;
    const before = await journal.read(agent.id);
    await expect(agent.send('Hello.', { inference: { contextProfile: invalid } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const response = await server.inject({
      method: 'POST', url: `/api/agents/${agent.id}/send`,
      payload: { input: 'Hello.', inference: { contextProfile: invalid } },
    });
    expect(response.statusCode).toBe(400);
    expect(await journal.read(agent.id)).toEqual(before);
    expect(calls).toBe(0);
  } finally {
    await server.close();
    await app.stop();
  }
});
