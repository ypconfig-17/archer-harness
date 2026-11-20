/** 极小解释器只负责控制权交接；持久化与能力语义由 Handler 解释。 */
import { describe, expect, it, vi } from 'vitest';
import { perform, run } from '@archer/kernel';

describe('Generator Runner', () => {
  it('按顺序解释意图并把结果交回流程，yield* 可组合子流程', async () => {
    const calls: string[] = [];
    function* read(): Generator<string, string, unknown> { return yield* perform<string, string>('read'); }
    function* task(): Generator<string, string, unknown> {
      const value = yield* read();
      const saved = yield* perform<string, string>(`save:${value}`);
      return saved;
    }
    expect(await run(task(), async (effect) => { calls.push(effect); return effect === 'read' ? 'text' : 'saved'; })).toBe('saved');
    expect(calls).toEqual(['read', 'save:text']);
  });

  it('Handler 抛错交给流程的 catch，流程可以继续提出意图', async () => {
    function* task(): Generator<string, string, unknown> {
      try { yield 'fail'; } catch { return yield* perform<string, string>('recover'); }
      return 'unexpected';
    }
    expect(await run(task(), (effect) => { if (effect === 'fail') throw new Error('provider'); return 'recovered'; })).toBe('recovered');
  });

  it('流程自身抛错不能再次注入 Generator.throw', async () => {
    function* task(): Generator<string, void, unknown> { yield 'read'; throw new Error('program'); }
    const program = task();
    const injected = vi.spyOn(program, 'throw');
    await expect(run(program, () => 'result')).rejects.toThrow('program');
    expect(injected).not.toHaveBeenCalled();
  });

  it('未捕获的 Handler 异常退出流程并执行 finally', async () => {
    let cleaned = false;
    function* task(): Generator<string, void, unknown> { try { yield 'write'; } finally { cleaned = true; } }
    await expect(run(task(), async () => { throw new Error('unknown'); })).rejects.toThrow('unknown');
    expect(cleaned).toBe(true);
  });

  it('没有意图时直接返回，不调用 Handler', async () => {
    function* task(): Generator<never, number, unknown> { yield* []; return 42; }
    const handler = vi.fn();
    expect(await run(task(), handler)).toBe(42);
    expect(handler).not.toHaveBeenCalled();
  });
});
