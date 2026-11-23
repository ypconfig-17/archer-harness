/** Context 只负责应用依赖，不形成能力注册表或泄露第三方容器。 */
import { describe, expect, it, vi } from 'vitest';
import { ArcherError } from '@archer/contracts';
import { createArcherContextBuilder, createServiceToken } from '@archer/runtime';

describe('类型化 Token 与装配', () => {
  it('取消监听器重入 dispose 时共享同一次释放', async () => {
    const release = vi.fn();
    const token = createServiceToken<number>('resource');
    const context = createArcherContextBuilder().provideFactory(token, () => 1, { dispose: release }).build();
    context.resolve(token);
    let reentered: Promise<void> | undefined;
    context.signal.addEventListener('abort', () => { reentered = context.dispose(); });
    const closing = context.dispose();
    expect(reentered).toBe(closing);
    await closing;
    expect(release).toHaveBeenCalledOnce();
  });

  it('同名 Token 的身份独立，借用值不自动关闭', async () => {
    const first = createServiceToken<{ close(): void }>('same');
    const second = createServiceToken<number>('same');
    const close = vi.fn();
    const context = createArcherContextBuilder().provideValue(first, { close }).provideValue(second, 42).build();
    expect(context.resolve(first).close).toBe(close);
    expect(context.resolve(second)).toBe(42);
    expect(Object.keys(context).sort()).toEqual(['dispose', 'resolve', 'signal']);
    expect(context).not.toHaveProperty('cradle');
    expect(context).not.toHaveProperty('container');
    await context.dispose();
    expect(close).not.toHaveBeenCalled();
  });

  it('工厂惰性创建单例，只释放实际创建过的服务', async () => {
    const token = createServiceToken<object>('service');
    const unused = createServiceToken<object>('unused');
    const factory = vi.fn(() => ({}));
    const dispose = vi.fn();
    const unusedFactory = vi.fn(() => ({}));
    const context = createArcherContextBuilder()
      .provideFactory(token, factory, { dispose })
      .provideFactory(unused, unusedFactory, { dispose })
      .build();
    expect(factory).not.toHaveBeenCalled();
    expect(context.resolve(token)).toBe(context.resolve(token));
    expect(factory).toHaveBeenCalledTimes(1);
    await context.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(unusedFactory).not.toHaveBeenCalled();
  });

  it('重复注册和重复构建明确拒绝，缺失服务使用 ArcherError', async () => {
    const token = createServiceToken<number>('value');
    const builder = createArcherContextBuilder().provideValue(token, 1);
    expect(() => builder.provideValue(token, 2)).toThrow(ArcherError);
    const context = builder.build();
    expect(() => builder.build()).toThrow(ArcherError);
    expect(() => builder.provideValue(createServiceToken('late'), 1)).toThrow(ArcherError);
    expect(() => context.resolve(createServiceToken('missing'))).toThrow(ArcherError);
    await context.dispose();
  });

  it('工厂失败和循环依赖不泄露第三方异常，失败不破坏其他服务', async () => {
    const first = createServiceToken<object>('first');
    const second = createServiceToken<object>('second');
    const bad = createServiceToken<object>('bad');
    const good = createServiceToken<number>('good');
    const context = createArcherContextBuilder()
      .provideFactory(first, scope => scope.resolve(second))
      .provideFactory(second, scope => scope.resolve(first))
      .provideFactory(bad, () => { throw new Error('internal implementation error'); })
      .provideValue(good, 42).build();
    expect(() => context.resolve(first)).toThrow('first -> second -> first');
    expect(() => context.resolve(bad)).toThrow(ArcherError);
    expect(() => context.resolve(bad)).not.toThrow('internal implementation error');
    expect(context.resolve(good)).toBe(42);
    await context.dispose();
  });

  it('异步初始化不被隐式等待，Promise 服务保持显式类型', async () => {
    const pending = Promise.resolve(42);
    const token = createServiceToken<Promise<number>>('pending');
    const disposed: number[] = [];
    const context = createArcherContextBuilder().provideFactory(token, () => pending, {
      dispose: async value => { disposed.push(await value); },
    }).build();
    expect(context.resolve(token)).toBe(pending);
    await context.dispose();
    expect(disposed).toEqual([42]);
  });
});

describe('资源释放', () => {
  it('按实际依赖构造顺序逆序、串行等待释放，不依赖注册顺序', async () => {
    const dependency = createServiceToken<object>('dependency');
    const dependent = createServiceToken<object>('dependent');
    const order: string[] = [];
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const context = createArcherContextBuilder()
      .provideFactory(dependent, scope => ({ dependency: scope.resolve(dependency) }), {
        dispose: async () => { order.push('dependent:start'); await waiting; order.push('dependent:end'); },
      })
      .provideFactory(dependency, () => ({}), { dispose: () => { order.push('dependency'); } })
      .build();
    context.resolve(dependent);
    const disposal = context.dispose();
    expect(context.dispose()).toBe(disposal);
    expect(context.signal.aborted).toBe(true);
    expect(() => context.resolve(dependency)).toThrow(ArcherError);
    await Promise.resolve();
    expect(order).toEqual(['dependent:start']);
    release();
    await disposal;
    expect(order).toEqual(['dependent:start', 'dependent:end', 'dependency']);
    await context.dispose();
    expect(order).toHaveLength(3);
  });

  it('一个释放器失败仍继续清理，其后不重新执行释放器', async () => {
    const first = createServiceToken<number>('first');
    const second = createServiceToken<number>('second');
    const order: string[] = [];
    const context = createArcherContextBuilder()
      .provideFactory(first, () => 1, { dispose: () => { order.push('first'); } })
      .provideFactory(second, () => 2, { dispose: () => { order.push('second'); throw new Error('close failed'); } }).build();
    context.resolve(first);
    context.resolve(second);
    await expect(context.dispose()).rejects.toMatchObject({ code: 'INTERNAL' });
    await expect(context.dispose()).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(order).toEqual(['second', 'first']);
  });

  it('父信号取消后禁止新解析，已拥有的资源仍可显式释放', async () => {
    const parent = new AbortController();
    const token = createServiceToken<number>('owned');
    const dispose = vi.fn();
    const context = createArcherContextBuilder({ signal: parent.signal }).provideFactory(token, () => 1, { dispose }).build();
    context.resolve(token);
    parent.abort();
    expect(context.signal.aborted).toBe(true);
    expect(() => context.resolve(token)).toThrow(ArcherError);
    await context.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('失败工厂已构造的依赖仍由 Context 清理', async () => {
    const dependency = createServiceToken<number>('dependency');
    const failure = createServiceToken<number>('failure');
    const dispose = vi.fn();
    const context = createArcherContextBuilder()
      .provideFactory(dependency, () => 1, { dispose })
      .provideFactory(failure, scope => { scope.resolve(dependency); throw new Error('failed'); }).build();
    expect(() => context.resolve(failure)).toThrow(ArcherError);
    await context.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

