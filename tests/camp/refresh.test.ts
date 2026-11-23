/** 刷新由容器重建实例，失败保留声明，旧资源等待借用排空。 */
import { expect, it, vi } from 'vitest';
import { createCamp, provider, skill, SKILL } from '@archer/camp';

function source(description: string, close = vi.fn(async () => undefined)) {
  return provider('skills', {
    review: skill({
      name: 'review',
      description,
      load: async () => ({ content: description }),
    }),
  }, { close });
}

it('工厂无需刷新方法，刷新发布新声明，旧引用在既有借用内仍可执行', async () => {
  let description = 'Before';
  const closed = vi.fn(async () => undefined);
  const camp = await createCamp({ providers: [{
    id: 'skills',
    create: () => source(description, closed),
  }] });
  const release = camp.acquire();
  const original = camp.list(SKILL)[0]!.ref;
  try {
    description = 'After';
    await camp.refreshProvider('skills');
    expect(camp.list(SKILL)[0]!.metadata.description).toBe('After');
    expect(camp.providers()[0]!.capabilities[0]!.metadata.description).toBe('After');
    expect(await camp.resolve(original, SKILL).load({ signal: camp.signal })).toEqual({ content: 'Before' });
    expect(closed).not.toHaveBeenCalled();
    release();
    await Promise.resolve();
    expect(() => camp.resolve(original, SKILL)).toThrow('unavailable');
  } finally {
    release();
    await camp.close();
  }
  expect(closed).toHaveBeenCalledTimes(2);
});

it('候选初始化失败不替换当前实例，之后仍能刷新', async () => {
  let fail = false;
  const camp = await createCamp({ providers: [{
    id: 'skills',
    create: () => fail
      ? { ...source('Broken'), open: async () => { throw new Error('open failed'); } }
      : source('Valid'),
  }] });
  try {
    const before = camp.list(SKILL);
    fail = true;
    await expect(camp.refreshProvider('skills')).rejects.toThrow('initialization failed');
    expect(camp.list(SKILL)).toEqual(before);
    fail = false;
    await camp.refreshProvider('skills');
  } finally {
    await camp.close();
  }
});

it('静态实例不具备重建定义，未知 ID 与工厂身份错误明确拒绝', async () => {
  let wrong = false;
  const camp = await createCamp({ providers: [
    provider('fixed', {}),
    { id: 'skills', create: () => wrong ? provider('other', {}) : source('Valid') },
  ] });
  try {
    await expect(camp.refreshProvider('fixed')).rejects.toThrow('creation definition');
    await expect(camp.refreshProvider('missing')).rejects.toThrow('creation definition');
    wrong = true;
    await expect(camp.refreshProvider('skills')).rejects.toThrow('different ID');
    expect(camp.list(SKILL)).toHaveLength(1);
  } finally {
    await camp.close();
  }
});

it('刷新准备期间关闭容器，候选不能发布且必须关闭', async () => {
  let unblock!: () => void;
  let entered!: () => void;
  const opened = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { unblock = resolve; });
  let refreshing = false;
  const closed = vi.fn(async () => undefined);
  const camp = await createCamp({ providers: [{
    id: 'skills',
    create: async () => {
      if (refreshing) {
        entered();
        await gate;
      }
      return source('Valid', closed);
    },
  }] });
  refreshing = true;
  const result = camp.refreshProvider('skills');
  const rejected = expect(result).rejects.toThrow('unavailable');
  await opened;
  const closing = camp.close();
  unblock();
  await rejected;
  await closing;
  expect(closed).toHaveBeenCalledTimes(2);
});

it('并发刷新串行创建，连续替换不改变其他 Provider 的声明顺序', async () => {
  let generation = 0;
  let constructing = false;
  const closed: number[] = [];
  const camp = await createCamp({ providers: [
    { id: 'skills', create: async () => {
      expect(constructing).toBe(false);
      constructing = true;
      const value = ++generation;
      await Promise.resolve();
      constructing = false;
      return source(String(value), vi.fn(async () => { closed.push(value); }));
    } },
    provider('other', {
      guide: skill({ name: 'guide', description: 'Guide.', load: async () => ({ content: 'Guide.' }) }),
    }),
  ] });
  try {
    await Promise.all([camp.refreshProvider('skills'), camp.refreshProvider('skills')]);
    expect(camp.list(SKILL).map(item => item.metadata.description)).toEqual(['3', 'Guide.']);
    expect(closed).toEqual([1, 2]);
  } finally {
    await camp.close();
  }
  expect(closed).toEqual([1, 2, 3]);
});

it('退役清理失败不撤销新声明，关闭聚合报告错误', async () => {
  let first = true;
  const camp = await createCamp({ providers: [{
    id: 'skills',
    create: () => {
      const fail = first;
      first = false;
      return source(fail ? 'Before' : 'After', vi.fn(async () => {
        if (fail) throw new Error('cleanup failed');
      }));
    },
  }] });
  await camp.refreshProvider('skills');
  expect(camp.list(SKILL)[0]!.metadata.description).toBe('After');
  await expect(camp.close()).rejects.toMatchObject({
    errors: [expect.objectContaining({ message: 'cleanup failed' })],
  });
});
