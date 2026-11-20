/** 验证控制权交接与异常传播，持久化恢复由 Runtime 测试覆盖。 */
import { describe, expect, it, vi } from 'vitest';
import { run } from '@archer/kernel';

describe('Generator Runner', () => {
  it('按顺序解释意图并把结果交回流程，yield* 可组合子流程', async () => {
    const calls: string[] = [];
    function* read(): Generator<string, string, string> {
      return yield 'read';
    }
    function* task(): Generator<string, string, string> {
      const value = yield* read();
      return yield `save:${value}`;
    }
    const result = await run(task(), async (effect) => {
      calls.push(effect);
      return effect === 'read' ? 'text' : 'saved';
    });
    expect(result).toBe('saved');
    expect(calls).toEqual(['read', 'save:text']);
  });

  it('Handler 抛错交给流程的 catch，流程可以继续提出意图', async () => {
    function* task(): Generator<string, string, string> {
      try {
        yield 'fail';
      } catch {
        return yield 'recover';
      }
      return 'unexpected';
    }
    const result = await run(task(), (effect) => {
      if (effect === 'fail') throw new Error('provider');
      return 'recovered';
    });
    expect(result).toBe('recovered');
  });

  it('流程恢复执行时抛出的异常直接传播', async () => {
    function* task(): Generator<string, void, string> {
      yield 'read';
      throw new Error('program');
    }
    const program = task();
    const injected = vi.spyOn(program, 'throw');
    await expect(run(program, () => 'result')).rejects.toThrow('program');
    expect(injected).not.toHaveBeenCalled();
  });

  it('首次 next 抛错时直接传播，不调用 Handler 或 throw', async () => {
    const error = new Error('initial');
    function firstIntent(): never {
      throw error;
    }
    function* task(): Generator<never, void, unknown> {
      // 首次求值意图时就抛错，确保 Generator 尚未把控制权交给 Handler。
      yield firstIntent();
    }
    const program = task();
    const injected = vi.spyOn(program, 'throw');
    const handler = vi.fn();
    await expect(run(program, handler)).rejects.toBe(error);
    expect(handler).not.toHaveBeenCalled();
    expect(injected).not.toHaveBeenCalled();
  });

  it('未捕获的 Handler 异常在 finally 的意图处理完后继续传播', async () => {
    const error = new Error('unknown');
    const calls: string[] = [];
    let cleanupResult: string | undefined;
    function* task(): Generator<string, void, string> {
      try {
        yield 'write';
      } finally {
        // throw 可以暂停在 finally 的 yield，恢复后原异常仍应传播。
        cleanupResult = yield 'cleanup';
      }
    }
    const execution = run(task(), async (effect) => {
      calls.push(effect);
      if (effect === 'write') throw error;
      return 'cleaned';
    });
    await expect(execution).rejects.toBe(error);
    expect(calls).toEqual(['write', 'cleanup']);
    expect(cleanupResult).toBe('cleaned');
  });

  it('没有意图时直接返回，不调用 Handler', async () => {
    function* task(intents: readonly string[]): Generator<string, number, unknown> {
      yield* intents;
      return 42;
    }
    const handler = vi.fn();
    expect(await run(task([]), handler)).toBe(42);
    expect(handler).not.toHaveBeenCalled();
  });
});
