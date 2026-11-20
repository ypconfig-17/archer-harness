/** 命名空间 JSONL：共享文件串行访问、完整行恢复、提交不确定性和幂等追加。 */
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { ArcherError, OperationRejected, canonicalJson } from '@archer/contracts';
import type { MemoryAppend, MemoryEntry } from './types.js';
import { APPEND_SCHEMA } from './prompt.js';
import { z } from 'zod';

// 重放逐条复用同一验证器，避免每次读取为全部历史重新编译 Schema。
const appendValidator = z.fromJSONSchema(JSON.parse(JSON.stringify(APPEND_SCHEMA)));

interface FileScope { tail: Promise<unknown>; refs: number; writeUnknown: boolean }
// 以真实文件坐标共享访问队列，避免同一进程内多个实例或目录别名绕过幂等检查。
const files = new Map<string, FileScope>();
function serial<T>(scope: FileScope, operation: () => Promise<T>): Promise<T> {
  const task = scope.tail.then(operation, operation);
  scope.tail = task.catch(() => undefined);
  return task;
}
function checkSignal(signal?: AbortSignal): void {
  if (signal?.aborted) throw new OperationRejected('Memory operation was cancelled before writing.', 'ABORTED');
}
function corrupt(message: string): never { throw new ArcherError('EVENT_LOG_CORRUPT', message); }

export function normalizeAppend(input: MemoryAppend): MemoryAppend {
  if (!appendValidator.safeParse({ ...input }).success) throw new OperationRejected('Memory append does not match the schema.', 'INVALID_ARGUMENT');
  if (!input.content.trim() || Buffer.byteLength(input.content, 'utf8') > 16_384) {
    throw new OperationRejected('Memory content must be non-empty and at most 16 KiB.', 'INVALID_ARGUMENT');
  }
  if (input.tags.some(tag => !tag.trim()) || input.source !== undefined && !input.source.trim()) {
    throw new OperationRejected('Memory tags and source must not be blank.', 'INVALID_ARGUMENT');
  }
  return { id: input.id, content: input.content, tags: [...new Set(input.tags.map(tag => tag.trim()))].sort(),
    ...(input.source !== undefined ? { source: input.source } : {}),
  };
}
function readEntries(raw: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [], ids = new Set<string>();
  // 仅完整换行记录可见；末尾不完整记录没有发布，追加前才修复残尾。
  const boundary = raw.lastIndexOf('\n');
  if (boundary < 0) return entries;
  for (const line of raw.slice(0, boundary).split('\n')) {
    if (!line || Buffer.byteLength(line, 'utf8') > 65_536) corrupt('Memory journal contains an invalid line.');
    let value: unknown;
    try { value = JSON.parse(line); } catch { corrupt('Memory journal contains malformed JSON.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) corrupt('Memory journal entry must be an object.');
    const entry = value as MemoryEntry;
    if (Object.keys(entry).some(key => !['seq', 'id', 'content', 'tags', 'source', 'createdAt'].includes(key))
      || entry.seq !== entries.length + 1 || !Number.isSafeInteger(entry.createdAt) || entry.createdAt < 0
      || !Array.isArray(entry.tags)) corrupt('Memory journal sequence or entry shape is invalid.');
    try {
      const normalized = normalizeAppend({ id: entry.id, content: entry.content, tags: entry.tags, ...(entry.source !== undefined ? { source: entry.source } : {}) });
      if (canonicalJson(normalized.tags) !== canonicalJson(entry.tags)) corrupt('Memory journal tags are not normalized.');
    } catch { corrupt('Memory journal entry does not match the memory contract.'); }
    if (ids.has(entry.id)) corrupt('Memory journal contains a duplicate id.');
    ids.add(entry.id);
    entries.push(entry);
  }
  return entries;
}

export class MemoryStore {
  private file?: string;
  private handle?: FileHandle;
  private scope?: FileScope;
  private state: 'created' | 'opening' | 'open' | 'closing' | 'closed' = 'created';
  private opening?: Promise<void>;
  private closing?: Promise<void>;

  constructor(private readonly directory: string, private readonly namespace: string) {}

  open(signal: AbortSignal): Promise<void> {
    if (this.state === 'closing' || this.state === 'closed') return Promise.reject(new ArcherError('CONFLICT', 'Memory resource cannot reopen.'));
    if (this.opening) return this.opening;
    if (this.state !== 'created') return Promise.reject(new ArcherError('CONFLICT', 'Memory resource cannot reopen.'));
    this.state = 'opening';
    this.opening = (async () => {
      checkSignal(signal);
      await mkdir(this.directory, { recursive: true });
      const directory = await realpath(this.directory);
      checkSignal(signal);
      const file = join(directory, createHash('sha256').update(this.namespace).digest('hex') + '.jsonl');
      this.file = file;
      let scope = files.get(file);
      if (!scope) { scope = { tail: Promise.resolve(), refs: 0, writeUnknown: false }; files.set(file, scope); }
      scope.refs++;
      this.scope = scope;
      await serial(scope, async () => {
        checkSignal(signal);
        this.handle = await open(file, 'a+');
        readEntries(await readFile(file, 'utf8'));
        // 重开时先同步已观察到的完整前缀，再允许幂等追加返回确认结果。
        await this.handle.sync();
        const parent = await open(directory, 'r');
        try { await parent.sync(); } finally { await parent.close(); }
        checkSignal(signal);
        this.state = 'open';
      });
    })();
    return this.opening;
  }

  private access<T>(operation: (scope: FileScope, handle: FileHandle, file: string) => Promise<T>): Promise<T> {
    const scope = this.scope, handle = this.handle, file = this.file;
    if (this.state !== 'open' || !scope || !handle || !file) return Promise.reject(new OperationRejected('Memory resource is not open.', 'CAPABILITY_UNAVAILABLE'));
    return serial(scope, async () => {
      if (this.state !== 'open') throw new OperationRejected('Memory resource is closing.', 'CAPABILITY_UNAVAILABLE');
      return operation(scope, handle, file);
    });
  }

  entries(signal?: AbortSignal): Promise<MemoryEntry[]> {
    return this.access(async (_scope, _handle, file) => {
      checkSignal(signal);
      const entries = readEntries(await readFile(file, 'utf8'));
      checkSignal(signal);
      return entries;
    });
  }

  append(input: MemoryAppend, signal?: AbortSignal): Promise<{ entry: MemoryEntry; created: boolean }> {
    return this.access(async (scope, handle, file) => {
      checkSignal(signal);
      if (scope.writeUnknown) throw new ArcherError('COMMIT_UNKNOWN', 'Memory write state is unknown; close all instances and reopen before another append.');
      let raw: string;
      let entries: MemoryEntry[];
      try { raw = await readFile(file, 'utf8'); entries = readEntries(raw); }
      catch (error) {
        throw new OperationRejected(error instanceof Error ? error.message : String(error), error instanceof ArcherError ? error.code : 'CAPABILITY_UNAVAILABLE');
      }
      const existing = entries.find(entry => entry.id === input.id);
      if (existing) {
        const previous = { id: existing.id, content: existing.content, tags: existing.tags,
          ...(existing.source !== undefined ? { source: existing.source } : {}),
        };
        if (canonicalJson(previous) !== canonicalJson({ ...input })) throw new OperationRejected('Memory id already exists with a different payload.', 'CONFLICT');
        return { entry: existing, created: false };
      }
      checkSignal(signal);
      const entry: MemoryEntry = { seq: entries.length + 1, ...input, createdAt: Date.now() };
      const serialized = JSON.stringify(entry) + '\n';
      if (Buffer.byteLength(serialized, 'utf8') > 65_536) throw new OperationRejected('Memory record exceeds 64 KiB.', 'INVALID_ARGUMENT');
      // 从修复残尾到写入及同步结束均属于写入窗口；异常只能报告结果未知。
      try {
        if (raw && !raw.endsWith('\n')) await handle.truncate(Buffer.byteLength(raw.slice(0, raw.lastIndexOf('\n') + 1), 'utf8'));
        await handle.writeFile(serialized, 'utf8');
        await handle.sync();
        const directory = await open(dirname(file), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      } catch (error) {
        scope.writeUnknown = true;
        throw new ArcherError('COMMIT_UNKNOWN', 'Memory append result is unknown.', { cause: error instanceof Error ? error.message : String(error) });
      }
      // 写入后即使取消也返回已确认结果，不能把成功写入伪装为未执行。
      return { entry, created: true };
    });
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.state = 'closing';
    this.closing = (async () => {
      await this.opening?.catch(() => undefined);
      this.state = 'closing';
      const scope = this.scope;
      try {
        if (scope) await serial(scope, async () => { await this.handle?.close(); });
      } finally {
        if (scope && --scope.refs === 0 && this.file) files.delete(this.file);
        this.handle = undefined;
        this.scope = undefined;
        this.state = 'closed';
      }
    })();
    return this.closing;
  }
}
