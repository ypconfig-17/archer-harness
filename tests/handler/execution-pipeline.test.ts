/**
 * Effect 执行管线：组合顺序与观测扩展。
 */

import { describe, expect, it } from 'vitest';
import { defaultContextProfile } from '@archer/contracts';
import type { Effect } from '@archer/contracts';
import {
  composeMiddleware,
  withAudit,
  type EffectExecutionRecord,
  type EffectHandler,
  type EffectMiddleware,
  type HandlerContext,
} from '@archer/handler';

const inferEffect: Effect = { promptPrefixCount: 0, type: 'INFER', target: { providerId: 'inference', capabilityId: 'model', contractId: 'archer.inference@1', revision: 'test' }, messages: [], config: { contextProfile: defaultContextProfile() } };

function context(now: () => number = () => 0): HandlerContext {
  return {
    inferenceHistory: [], effectRequests: [], compactions: [],
    executeInference: async (request, purpose, run) => ({ requestId: 'request-1', attempt: 1, request, purpose, status: 'completed', result: await run() }),
    commitCompaction: async () => { throw new Error('Unexpected compaction.'); },
    agentId: 'agent-1',
    turnId: 'turn-1',
    effectId: 'effect-1',
    signal: new AbortController().signal,
    now,
    inference: { infer: async () => ({ content: '' }) },
    prepare: async () => null,
    target: null,
    targetError: null,
    isStopping: () => false,
  };
}

function marker(name: string, order: string[]): EffectMiddleware {
  return (next) => async (effect, ctx) => {
    order.push(`${name}:before`);
    const outcome = await next(effect, ctx);
    order.push(`${name}:after`);
    return outcome;
  };
}

describe('Effect 执行管线', () => {
  it('中间件按声明顺序从外到内执行', async () => {
    const order: string[] = [];
    const terminal: EffectHandler = async () => {
      order.push('handler');
      return { status: 'failed', error: { code: 'INTERNAL', message: 'x' }, durationMs: 0 };
    };
    const pipeline = composeMiddleware(terminal, [
      marker('outer', order),
      marker('inner', order),
    ]);

    await pipeline(inferEffect, context());

    expect(order).toEqual([
      'outer:before',
      'inner:before',
      'handler',
      'inner:after',
      'outer:after',
    ]);
  });

  it('审计扩展只观察结果，不改变 handler 返回值', async () => {
    const records: EffectExecutionRecord[] = [];
    const handler: EffectHandler = async () => ({
      status: 'completed',
      result: { content: 'ok' },
      durationMs: 3,
    });
    const pipeline = composeMiddleware(handler, [withAudit((record) => records.push(record))]);

    const outcome = await pipeline(inferEffect, context(() => 20));

    expect(outcome).toEqual({
      status: 'completed',
      result: { content: 'ok' },
      durationMs: 3,
    });
    expect(records).toEqual([
      {
        agentId: 'agent-1',
        turnId: 'turn-1',
        effectId: 'effect-1',
        type: 'INFER',
        status: 'completed',
        durationMs: 0,
      },
    ]);
  });

  it('审计回调异常不影响执行结果', async () => {
    const handler: EffectHandler = async () => ({
      status: 'completed',
      result: { content: 'ok' },
      durationMs: 1,
    });
    const pipeline = composeMiddleware(handler, [
      withAudit(() => {
        throw new Error('sink failed');
      }),
    ]);

    const outcome = await pipeline(inferEffect, context());

    if (!outcome) throw new Error('Expected a completed outcome');
    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') {
      expect(outcome.result).toEqual({ content: 'ok' });
    }
  });
});

describe('可靠执行包装', () => {
  it('开始提交、能力调用、结果提交严格排序', async () => {
    const { withJournal } = await import('@archer/handler');
    const order: string[] = [];
    const handler: EffectHandler = async () => { order.push('execute'); return { status: 'completed', result: { content: 'ok' }, durationMs: 0 }; };
    await composeMiddleware(handler, [withJournal])(inferEffect, { ...context(), journal: {
      begin: async () => { order.push('commit-start'); return true; },
      complete: async () => { order.push('commit-result'); },
      suspend: async () => { throw new Error('unexpected'); },
    } });
    expect(order).toEqual(['commit-start', 'execute', 'commit-result']);
  });

  it('开始提交失败时不调用能力；结果提交失败原样传播而不重试', async () => {
    const { withJournal } = await import('@archer/handler');
    let calls = 0;
    const handler: EffectHandler = async () => { calls++; return { status: 'completed', result: { content: 'ok' }, durationMs: 0 }; };
    const wrapped = composeMiddleware(handler, [withJournal]);
    const journal = { begin: async () => { throw new Error('commit unknown'); }, complete: async () => {}, suspend: async () => {} };
    await expect(wrapped(inferEffect, { ...context(), journal })).rejects.toThrow('commit unknown');
    expect(calls).toBe(0);
    await expect(wrapped(inferEffect, { ...context(), journal: { ...journal, begin: async () => true, complete: async () => { throw new Error('result commit unknown'); } } })).rejects.toThrow('result commit unknown');
    expect(calls).toBe(1);
  });

  it('人工请求只持久化等待，不开始执行或向流程伪造完成结果', async () => {
    const { withHumanInteraction, withJournal } = await import('@archer/handler');
    const order: string[] = [];
    const handler: EffectHandler = async () => { order.push('execute'); return null; };
    const outcome = await composeMiddleware(handler, [withHumanInteraction, withJournal])({ type: 'ASK_HUMAN', reason: 'Approve?' }, { ...context(), journal: {
      begin: async () => { order.push('begin'); return true; }, complete: async () => { order.push('complete'); }, suspend: async () => { order.push('persist-wait'); },
    } });
    expect(outcome).toBeNull();
    expect(order).toEqual(['persist-wait']);
  });
});

describe('Runtime 固定装配', () => {
  it('开始提交后调用推理，观测之后才提交结果', async () => {
    const { createExecutionPipeline } = await import('@archer/handler');
    const order: string[] = [];
    const pipeline = createExecutionPipeline(() => { order.push('observe'); });
    const outcome = await pipeline(inferEffect, {
      ...context(),
      inference: { infer: async () => { order.push('infer'); return { content: 'ok' }; } },
      journal: {
        begin: async () => { order.push('begin'); return true; },
        complete: async () => { order.push('complete'); },
        suspend: async () => { order.push('suspend'); },
      },
    });
    expect(outcome?.status).toBe('completed');
    expect(order).toEqual(['begin', 'infer', 'observe', 'complete']);
  });

  it('目标不可用的 CALL 提交拒绝结果，不进入能力或观测回调', async () => {
    const { createExecutionPipeline } = await import('@archer/handler');
    const order: string[] = [];
    const pipeline = createExecutionPipeline(() => { order.push('observe'); });
    const outcome = await pipeline({ type: 'CALL', target: inferEffect.target, input: {} }, {
      ...context(),
      journal: {
        begin: async () => { order.push('begin'); return true; },
        complete: async result => { order.push(result.status); },
        suspend: async () => { order.push('suspend'); },
      },
    });
    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'EFFECT_UNSUPPORTED' } });
    expect(order).toEqual(['begin', 'failed']);
  });

  it('开始未获确认时不调用模型、观测或提交结果', async () => {
    const { createExecutionPipeline } = await import('@archer/handler');
    const order: string[] = [];
    const outcome = await createExecutionPipeline(() => { order.push('observe'); })(inferEffect, {
      ...context(),
      inference: { infer: async () => { order.push('infer'); return { content: 'ok' }; } },
      journal: {
        begin: async () => false,
        complete: async () => { order.push('complete'); },
        suspend: async () => { order.push('suspend'); },
      },
    });
    expect(outcome).toBeNull();
    expect(order).toEqual([]);
  });
});
