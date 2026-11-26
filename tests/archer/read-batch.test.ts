/** 只读工具批次受控并发：聚合连续 read 调用、保持结果顺序、写操作截断与授权隔离。 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Archer, CallBatchEffect, Effect, Inference } from '@archer/contracts';
import { createArcher } from '@archer/runtime';
import { withAuthorization, type HandlerContext } from '@archer/handler';
import { provider, tool } from '@archer/camp';
import { MemoryAgentJournal } from '@archer/storage';
import { testCamp } from '../helpers/application';

const running: Archer[] = [];
afterEach(async () => {
  for (const app of running.splice(0)) await app.stop();
});

describe('只读工具批次并发', () => {
  it('连续只读调用并发执行为单个 CALL_BATCH，并按原 toolCallId 顺序折叠结果', async () => {
    const journal = new MemoryAgentJournal();
    let inFlight = 0;
    let maxInFlight = 0;
    let releaseBarrier!: () => void;
    const allThreeEntered = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });

    const readTool = tool({
      description: 'Read item.',
      inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
      execution: 'read',
      invoke: async (input) => {
        const key = (input as { key: string }).key;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        if (inFlight === 3) releaseBarrier();
        await allThreeEntered;
        // 故意错开返回时机，验证最终消息历史仍按原调用顺序对齐。
        if (key === 'a') await new Promise((r) => setTimeout(r, 15));
        if (key === 'b') await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return { key };
      },
    });

    const inference: Inference = {
      infer: async (effect) => {
        if (effect.messages.some((m) => m.role === 'tool')) {
          return { content: 'All read.' };
        }
        const toolName = effect.tools![0]!.name;
        return {
          content: '',
          stopReason: 'toolUse',
          toolCalls: [
            { id: 'c1', name: toolName, input: { key: 'a' } },
            { id: 'c2', name: toolName, input: { key: 'b' } },
            { id: 'c3', name: toolName, input: { key: 'c' } },
          ],
        };
      },
    };

    const app = createArcher({
      camp: testCamp({
        journal,
        inference,
        builtins: false,
        providers: [provider('fs', { readItem: readTool })],
      }),
    });
    running.push(app);
    await app.start();
    const agent = await app.agents.create({ id: 'batch-read', instructions: 'Read items.' });

    await agent.prompt('Read a, b, c');

    expect(maxInFlight).toBe(3);
    const createdEffects = (await agent.events())
      .filter((e) => e.fact.scope === 'turn' && e.fact.event.type === 'effect.created')
      .map((e) => (e.fact.scope === 'turn' && e.fact.event.type === 'effect.created' ? e.fact.event.data.effect.type : ''));
    expect(createdEffects).toEqual(['INFER', 'CALL_BATCH', 'INFER']);

    const state = await agent.getState();
    const toolMessages = state.messages.filter((m) => m.role === 'tool');
    expect(toolMessages.map((m) => ({ id: m.toolCallId, content: m.content }))).toEqual([
      { id: 'c1', content: '{"key":"a"}' },
      { id: 'c2', content: '{"key":"b"}' },
      { id: 'c3', content: '{"key":"c"}' },
    ]);
    expect(state.messages.at(-1)?.content).toBe('All read.');
  });

  it('遇到写操作时立即截断批次，保持写操作单条串行', async () => {
    const journal = new MemoryAgentJournal();
    const executionOrder: string[] = [];

    const readTool = tool({
      description: 'Read.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      execution: 'read',
      invoke: async (input) => {
        const id = (input as { id: string }).id;
        executionOrder.push(`read:${id}`);
        return { id };
      },
    });
    const writeTool = tool({
      description: 'Write.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      execution: 'write',
      invoke: async (input) => {
        const id = (input as { id: string }).id;
        executionOrder.push(`write:${id}`);
        return { id };
      },
    });

    const inference: Inference = {
      infer: async (effect) => {
        if (effect.messages.some((m) => m.role === 'tool')) {
          return { content: 'Mixed done.' };
        }
        const readName = effect.tools!.find((t) => t.name.endsWith('readItem'))!.name;
        const writeName = effect.tools!.find((t) => t.name.endsWith('writeItem'))!.name;
        return {
          content: '',
          stopReason: 'toolUse',
          toolCalls: [
            { id: 'r1', name: readName, input: { id: '1' } },
            { id: 'r2', name: readName, input: { id: '2' } },
            { id: 'w1', name: writeName, input: { id: '3' } },
            { id: 'r3', name: readName, input: { id: '4' } },
          ],
        };
      },
    };

    const app = createArcher({
      camp: testCamp({
        journal,
        inference,
        builtins: false,
        providers: [provider('fs', { readItem: readTool, writeItem: writeTool })],
      }),
    });
    running.push(app);
    await app.start();
    const agent = await app.agents.create({ id: 'mixed-batch', instructions: 'Mixed ops.' });

    await agent.prompt('Run mixed');

    const createdEffects = (await agent.events())
      .filter((e) => e.fact.scope === 'turn' && e.fact.event.type === 'effect.created')
      .map((e) => (e.fact.scope === 'turn' && e.fact.event.type === 'effect.created' ? e.fact.event.data.effect.type : ''));
    expect(createdEffects).toEqual(['INFER', 'CALL_BATCH', 'CALL', 'CALL', 'INFER']);
    expect(executionOrder.slice(2)).toEqual(['write:3', 'read:4']);
  });

  it('只读批次中单项失败只标记该项错误，不影响同行只读结果', async () => {
    const journal = new MemoryAgentJournal();

    const readTool = tool({
      description: 'Read.',
      inputSchema: { type: 'object', properties: { fail: { type: 'boolean' } }, required: ['fail'] },
      execution: 'read',
      invoke: async (input) => {
        if ((input as { fail: boolean }).fail) throw new Error('Read boom');
        return { ok: true };
      },
    });

    const inference: Inference = {
      infer: async (effect) => {
        if (effect.messages.some((m) => m.role === 'tool')) {
          return { content: 'Handled partial error.' };
        }
        const readName = effect.tools![0]!.name;
        return {
          content: '',
          stopReason: 'toolUse',
          toolCalls: [
            { id: 'c1', name: readName, input: { fail: false } },
            { id: 'c2', name: readName, input: { fail: true } },
          ],
        };
      },
    };

    const app = createArcher({
      camp: testCamp({
        journal,
        inference,
        builtins: false,
        providers: [provider('fs', { readItem: readTool })],
      }),
    });
    running.push(app);
    await app.start();
    const agent = await app.agents.create({ id: 'partial-fail', instructions: 'Read.' });

    await agent.prompt('Read two');

    const toolMessages = (await agent.getState()).messages.filter((m) => m.role === 'tool');
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages[0]).toMatchObject({ toolCallId: 'c1', content: '{"ok":true}' });
    expect(toolMessages[0]!.isError).toBeUndefined();
    expect(toolMessages[1]).toMatchObject({ toolCallId: 'c2', isError: true });
    expect(toolMessages[1]!.content).toContain('Read boom');
  });

  it('authorization 中间件拒绝包含非只读能力的 CALL_BATCH', async () => {
    const ref = { providerId: 'test', capabilityId: 'write', contractId: 'archer.tool@1', revision: 'r1' };
    const batch: CallBatchEffect = {
      type: 'CALL_BATCH',
      calls: [
        { target: ref, input: {}, toolCallId: 'c1', toolName: 'test_write' },
        { target: ref, input: {}, toolCallId: 'c2', toolName: 'test_write' },
      ],
    };
    const context: HandlerContext = {
      agentId: 'a1',
      turnId: 't1',
      effectId: 'e1',
      signal: new AbortController().signal,
      now: () => 0,
      inference: { infer: async () => ({ content: '' }) },
      inferenceHistory: [],
      effectRequests: [],
      compactions: [],
      executeInference: async () => { throw new Error('unused'); },
      commitCompaction: async () => { throw new Error('unused'); },
      prepare: async () => null,
      target: null,
      targetError: null,
      batchTargets: [
        { ref, metadata: { description: 'w', inputSchema: { type: 'object' }, execution: 'write' }, invoke: async () => null },
        { ref, metadata: { description: 'r', inputSchema: { type: 'object' }, execution: 'read' }, invoke: async () => null },
      ],
      batchErrors: [null, null],
      isStopping: () => false,
    };

    const handler = withAuthorization(async () => ({ status: 'completed', result: { results: [] }, durationMs: 0 }));
    const outcome = await handler(batch as Effect, context);
    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'PERMISSION_DENIED' } });
  });
});
