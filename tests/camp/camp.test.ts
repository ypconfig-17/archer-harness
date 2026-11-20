/** Camp 独立于 Archer，验证声明、来源引用和资源所有权。 */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createCamp, provider, tool, skill, contract, offer, TOOL, SKILL } from '@archer/camp';
const operation = () => tool({ description: 'Run.', inputSchema: { type: 'object' }, execution: 'read', invoke: async () => 'ok' });
describe('Camp', () => {
  it('一个 Provider 提供多个同类和不同类契约，调用保留实际接口', async () => {
    const camp = await createCamp({ providers: [provider('git', { status: operation(), diff: operation(), review: skill({ name: 'review', description: 'Review changes.', load: async () => ({ content: 'Inspect changes.' }) }) })] });
    try {
      expect(camp.list(TOOL).map(item => item.ref.capabilityId)).toEqual(['status', 'diff']);
      const ref = camp.list(SKILL)[0]!.ref;
      expect(await camp.resolve(ref, SKILL).load({ signal: camp.signal })).toEqual({ content: 'Inspect changes.' });
      expect(() => camp.resolve(ref, TOOL)).toThrow('unavailable');
    } finally { await camp.close(); }
  });
  it('自定义 Contract 不需要修改 Camp', async () => {
    const SEARCH = contract<{ query(text: string): string[] }, { description: string }>('example.search@1', z.object({ description: z.string() }), ['query']);
    const impl = { prefix: 'result:', query(text: string) { return [this.prefix + text]; } };
    const camp = await createCamp({ providers: [provider('search', { index: offer(SEARCH, { description: 'Search.' }, impl) })] });
    try { expect(camp.resolve(camp.list(SEARCH)[0]!.ref, SEARCH).query('a')).toEqual(['result:a']); }
    finally { await camp.close(); }
  });
  it('全部声明在初始化之前校验，重复 ID 和缺失方法明确失败', async () => {
    const open = vi.fn();
    await expect(createCamp({ providers: [provider('same', { run: operation() }, { open }), provider('same', {})] })).rejects.toThrow('duplicate');
    expect(open).not.toHaveBeenCalled();
    await expect(createCamp({ providers: [provider('broken', { run: offer(TOOL, { description: 'Broken.', inputSchema: {}, execution: 'read' }, {} as never) })] })).rejects.toThrow('requires invoke');
    expect(() => contract('bad', z.object({}), ['invoke'])).toThrow();
  });
  it('来源或声明修订变化不能解析旧引用，重建相同声明可以恢复', async () => {
    const source = (version: number) => provider('git', { status: operation() }, { identity: { version } });
    const first = await createCamp({ providers: [source(1)] }); const ref = first.list(TOOL)[0]!.ref; await first.close();
    const same = await createCamp({ providers: [source(1)] });
    expect(await same.resolve(ref, TOOL).invoke({}, { signal: same.signal })).toBe('ok'); await same.close();
    const changed = await createCamp({ providers: [source(2)] });
    expect(() => changed.resolve(ref, TOOL)).toThrow('unavailable'); await changed.close();
  });
  it('声明和返回值与调用方对象隔离，模型映射不能修改已接入来源', async () => {
    const declaration = provider('git', { status: operation() });
    const camp = await createCamp({ providers: [declaration] });
    try {
      const original = camp.list(TOOL)[0]!.ref;
      Reflect.set(declaration.identity, 'changed', true);
      const info = camp.providers(); Reflect.set(info[0]!.identity, 'changed', true);
      const list = camp.list(TOOL); list[0]!.ref.revision = 'tampered'; list[0]!.metadata.description = 'tampered';
      expect(camp.list(TOOL)[0]!.ref).toEqual(original);
      expect(camp.providers()[0]!.identity).toEqual({ provider: 'git' });
      expect(camp.list(TOOL)[0]!.metadata.description).toBe('Run.');
    } finally { await camp.close(); }
  });
  it('初始化失败逆序释放成功交付的资源，清理错误一并报告', async () => {
    const order: string[] = [];
    await expect(createCamp({ providers: [
      provider('a', {}, { open: async () => { order.push('open-a'); }, close: async () => { order.push('close-a'); throw new Error('close failed'); } }),
      provider('b', {}, { open: async () => { throw new Error('open failed'); } }),
    ] })).rejects.toMatchObject({ errors: [expect.objectContaining({ message: 'open failed' }), expect.objectContaining({ message: 'close failed' })] });
    expect(order).toEqual(['open-a', 'close-a']);
  });
  it('共享借用结束后才逆序关闭，每个资源只释放一次', async () => {
    const order: string[] = [];
    const camp = await createCamp({ providers: ['a', 'b'].map(id => provider(id, {}, { close: async () => { order.push(id); } })) });
    const release = camp.acquire(); const closing = camp.close();
    expect(camp.close()).toBe(closing); await Promise.resolve(); expect(order).toEqual([]);
    release(); release(); await closing; expect(order).toEqual(['b', 'a']);
    expect(() => camp.acquire()).toThrow('unavailable');
  });
});

it('显式可选契约方法绑定原对象，缺失允许，非函数拒绝，未声明成员不暴露', async () => {
  const CHECK = contract<{ run(): string; inspect?(): string }, Record<string, never>>('example.inspect@1', z.object({}).strict(), ['run'], ['inspect']);
  const implementation = { label: 'fixed', run() { return this.label; }, inspect() { return this.label; }, secret() { return 'hidden'; } };
  const camp = await createCamp({ providers: [provider('source', { full: offer(CHECK, {}, implementation), minimal: offer(CHECK, {}, { run: () => 'ok' }) })] });
  try {
    const full = camp.resolve(camp.list(CHECK)[0]!.ref, CHECK);
    expect(full.inspect!()).toBe('fixed'); expect('secret' in full).toBe(false);
    expect(camp.resolve(camp.list(CHECK)[1]!.ref, CHECK).inspect).toBeUndefined();
  } finally { await camp.close(); }
  await expect(createCamp({ providers: [provider('source', { broken: offer(CHECK, {}, { run: () => 'ok', inspect: 'wrong' } as never) })] })).rejects.toThrow('requires inspect');
});
