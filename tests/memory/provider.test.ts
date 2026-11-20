/** 持久化记忆是普通 Provider，命名空间和幂等语义不依赖 Agent 实现。 */
import { mkdtemp, readFile, appendFile, readdir, rm, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JsonObject } from '@archer/contracts';
import { freezeSnapshot } from '@archer/contracts';
import { memoryProvider } from '@archer/memory';
import { createArcherContextBuilder } from '@archer/runtime';


const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'archer-memory-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function memory(directory: string, namespace = 'project:archer') {
  const context = createArcherContextBuilder().build();
  cleanups.push(() => context.dispose());
  const resource = memoryProvider({ directory, namespace });
  cleanups.push(() => resource.close?.());
  await resource.open?.({ signal: context.signal });

  const call = async (name: string, input: JsonObject, signal?: AbortSignal): Promise<any> => resource.capabilities[name]!.implementation[name === 'context' ? 'prepare' : 'invoke'](input, { signal: signal ?? context.signal });
  return { resource, call };
}

describe('持久化记忆 Provider', () => {
  it('工厂只构造对象，配置必须明确目录和命名空间', async () => {
    const root = await directory();
    const context = createArcherContextBuilder().build();
    cleanups.push(() => context.dispose());
    const invalid: JsonObject[] = [{ directory: root }, { directory: '.', namespace: 'x' }, { directory: root, namespace: '' }, { directory: root, namespace: 'x', autoSave: true }];
    for (const config of invalid) {
      expect(() => memoryProvider(config)).toThrow();
    }
    const target = join(root, 'created-on-open');
    const resource = memoryProvider({ directory: target, namespace: 'project' });
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    await resource.open?.({ signal: context.signal });
    await resource.close?.();
    expect((await stat(target)).isDirectory()).toBe(true);
  });

  it('能力声明可发现，主动保存和检索使用 Tool.invoke，关闭后不能访问数据', async () => {
    const m = await memory(await directory());
    expect(Object.keys(m.resource.capabilities)).toEqual(['append', 'get', 'search', 'context']);
    const first = await m.call('append', { id: 'preference.language', content: '用户希望中文回答。', tags: [' preference ', 'language', 'language'], source: 'user-request' });
    expect(first).toMatchObject({ namespace: 'project:archer', created: true, entry: { seq: 1, id: 'preference.language', tags: ['language', 'preference'], source: 'user-request' } });
    expect(first.entry.createdAt).toBeGreaterThan(0);
    expect(await m.call('get', { id: 'preference.language' })).toEqual({ namespace: 'project:archer', entry: first.entry });
    expect(await m.call('get', { id: 'missing' })).toEqual({ namespace: 'project:archer', entry: null });
    const result = await m.call('search', { query: '请用中文回答' });
    expect(result.matches[0].id).toBe('preference.language');
    expect(Object.isFrozen(result.matches)).toBe(true);
    await m.resource.close?.();
    await expect(m.call('search', {})).rejects.toThrow('not open');
    await expect(m.call('context', { query: '' })).rejects.toThrow('not open');
  });

  it('同 id 同规范化输入幂等，不同内容或来源冲突，不覆盖旧条目', async () => {
    const root = await directory();
    const m = await memory(root);
    const first = await m.call('append', { id: 'same', content: 'A durable fact.', tags: ['b', 'a'] });
    expect(await m.call('append', { id: 'same', content: 'A durable fact.', tags: [' a ', 'b', 'a'] })).toEqual({ ...first, created: false });
    await expect(m.call('append', { id: 'same', content: 'Different.' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(m.call('append', { id: 'same', content: 'A durable fact.', tags: ['a', 'b'], source: 'different' })).rejects.toMatchObject({ code: 'CONFLICT' });
    const file = join(root, (await readdir(root))[0]);
    expect((await readFile(file, 'utf8')).trim().split('\n')).toHaveLength(1);
    expect((await m.call('get', { id: 'same' })).entry.content).toBe('A durable fact.');
  });

  it('多个实例与符号链接别名共享写入边界，重复 ID 不会并发插入', async () => {
    const root = await directory();
    const data = join(root, 'data');
    const first = await memory(data);
    await symlink(data, join(root, 'alias'));
    const second = await memory(join(root, 'alias'));
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second).call('append', { id: 'same', content: 'Once.' })));
    expect(results.filter(result => result.created)).toHaveLength(1);
    await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second).call('append', { id: `id-${index}`, content: `Entry ${index}` })));
    const raw = await readFile(join(data, (await readdir(data))[0]), 'utf8');
    expect(raw.trim().split('\n').map(line => JSON.parse(line).seq)).toEqual(Array.from({ length: 21 }, (_, index) => index + 1));
  });

  it('冷重开保留内容，命名空间不共享条目，也不能构造宿主路径', async () => {
    const root = await directory();
    const first = await memory(root, '../project-a');
    await first.call('append', { id: 'entry', content: 'Project A.' });
    await first.resource.close?.();
    const restored = await memory(root, '../project-a');
    const other = await memory(root, 'project-b');
    expect((await restored.call('get', { id: 'entry' })).entry.content).toBe('Project A.');
    expect((await other.call('get', { id: 'entry' })).entry).toBe(null);
    expect((await readdir(root)).every(name => /^[a-f0-9]{64}\.jsonl$/.test(name))).toBe(true);
  });

  it('只忽略未完成残尾，下一次追加修复残尾并保留全部已发布条目', async () => {
    const root = await directory();
    const first = await memory(root);
    await first.call('append', { id: 'one', content: 'One.' });
    await first.resource.close?.();
    const file = join(root, (await readdir(root))[0]);
    await appendFile(file, '{"seq":2,"id":"unfinished"');
    const restored = await memory(root);
    expect((await restored.call('get', { id: 'unfinished' })).entry).toBe(null);
    const second = await restored.call('append', { id: 'two', content: 'Two.' });
    expect(second.entry.seq).toBe(2);
    const lines = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(lines.map(entry => entry.id)).toEqual(['one', 'two']);
  });

  it('完整损坏行明确拒绝打开，不自动吞掉坏数据', async () => {
    const root = await directory();
    const first = await memory(root);
    await first.resource.close?.();
    const file = join(root, (await readdir(root))[0]);
    await appendFile(file, '{bad JSON}\n');
    await expect(memory(root)).rejects.toMatchObject({ code: 'EVENT_LOG_CORRUPT' });
    expect(await readFile(file, 'utf8')).toBe('{bad JSON}\n');
  });

  it('检索支持英文大小写、中文双字词、标签和稳定的近期排序', async () => {
    const m = await memory(await directory());
    await m.call('append', { id: 'one', content: 'Prefer TypeScript for projects.' });
    await m.call('append', { id: 'two', content: 'Use Chinese responses.', tags: ['TypeScript'] });
    expect((await m.call('search', { query: 'TYPESCRIPT' })).matches.map((match: any) => match.id)).toEqual(['two', 'one']);
    expect((await m.call('search', {})).matches.map((match: any) => match.id)).toEqual(['two', 'one']);
    expect((await m.call('search', { query: 'nonexistent' })).matches).toEqual([]);
    expect((await m.call('search', { query: '!!!' })).matches).toEqual([]);
    const limited = await m.call('search', { limit: 1 });
    expect(limited).toMatchObject({ total: 2, truncated: true });
  });

  it('长内容返回显式截断的命中片段，完整内容仍可按 id 读取', async () => {
    const m = await memory(await directory());
    const content = 'a'.repeat(700) + ' relevant keyword ' + 'b'.repeat(700);
    await m.call('append', { id: 'long', content });
    const result = await m.call('search', { query: 'keyword' });
    expect(result.truncated).toBe(true);
    expect(result.matches[0].excerpt).toContain('keyword');
    expect(result.matches[0].excerpt.length).toBeLessThan(520);
    expect((await m.call('get', { id: 'long' })).entry.content).toBe(content);
  });

  it('context 需要显式查询或推理快照，空查询不自动注入近期记忆', async () => {
    const m = await memory(await directory());
    await m.call('append', { id: 'fact', content: '中文回答。' });
    await expect(m.call('context', {})).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect((await m.call('context', { query: '' })).matches).toEqual([]);
    expect((await m.call('context', { query: '中文回答' })).matches[0].id).toBe('fact');
  });

  it('context 从不可变快照中选择最新 user 消息，不读取工具文本或修改历史', async () => {
    const root = await directory();
    const m = await memory(root);
    await m.call('append', { id: 'language', content: '用户希望中文回答。' });
    const signal = new AbortController().signal;
    const inference = freezeSnapshot({ messages: [
      { role: 'system' as const, content: 'Original system instructions.' },
      { role: 'user' as const, content: 'Unrelated old query.' },
      { role: 'assistant' as const, content: 'Previous response.' },
      { role: 'user' as const, content: '请用中文回答' },
      { role: 'tool' as const, content: 'Unrelated tool output.' },
    ] });
    const context = { signal, inference };
    const result = await m.resource.capabilities.context!.implementation.prepare({}, context) as any;
    expect(result.query).toBe('请用中文回答');
    expect(result.matches[0].id).toBe('language');
    expect(inference.messages[0].content).toBe('Original system instructions.');
    expect(inference.messages).toHaveLength(5);
    expect((await readFile(join(root, (await readdir(root))[0]), 'utf8')).trim().split('\n')).toHaveLength(1);
  });

  it('context 为 Runtime 预留大小预算，缩减条目时明确标记截断', async () => {
    const m = await memory(await directory());
    for (let index = 0; index < 10; index++) await m.call('append', {
      id: `entry-${index}`, content: '记忆'.repeat(256),
      tags: Array.from({ length: 16 }, (_, tag) => '标'.repeat(60) + tag), source: '来'.repeat(1024),
    });
    const result = await m.call('context', { query: '记忆', limit: 10 });
    expect(result.total).toBe(10);
    expect(result.truncated).toBe(true);
    expect(result.matches.length).toBeLessThan(10);
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(49_152);
  });

  it('输入限制与写入前取消不产生条目，资源 close 幂等', async () => {
    const m = await memory(await directory());
    const invalid: JsonObject[] = [{ id: '../bad', content: 'text' }, { id: 'blank', content: '  ' }, { id: 'big', content: '中'.repeat(8192) }, { id: 'tag', content: 'text', tags: [' '] }];
    for (const input of invalid) {
      await expect(m.call('append', input)).rejects.toThrow();
    }
    const controller = new AbortController(); controller.abort();
    await expect(m.call('append', { id: 'cancelled', content: 'No.' }, controller.signal)).rejects.toThrow();
    expect((await m.call('search', {})).matches).toEqual([]);
    const closing = m.resource.close!();
    expect(m.resource.close!()).toBe(closing);
    await closing;
    await expect(m.resource.open!({ signal: new AbortController().signal })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
