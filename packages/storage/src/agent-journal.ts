/**
 * Archer Harness — AgentJournal 实现
 *
 * 每个 Agent 一个 append-only JSONL 日志；一批事件占一行。
 * 写入方负责 id / seq / turnSeq / ts，expectedSeq 提供 CAS 基线。
 */

import { mkdir, open, readFile, readdir, stat, unlink, type FileHandle } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import type {
  AgentAppendInput,
  AgentDraft,
  AgentEvent,
  AgentJournal,
  ErrorData,
} from '@archer/contracts';
import { AgentEventSchema, ArcherError } from '@archer/contracts';

const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function assertAgentId(agentId: string): void {
  if (!AGENT_ID_PATTERN.test(agentId)) {
    throw new ArcherError('INVALID_ARGUMENT', `非法的 Agent ID：${agentId}`);
  }
}

function corrupt(message: string): never {
  throw new ArcherError('EVENT_LOG_CORRUPT', message);
}

type TurnSeqMap = Map<string, number>;

function assignDrafts(
  agentId: string,
  drafts: readonly AgentDraft[],
  expectedSeq: number,
  lastTs: number,
  turnSeq: TurnSeqMap,
  now: number,
): AgentEvent[] {
  let seq = expectedSeq;
  let ts = lastTs;
  return drafts.map((draft) => {
    seq += 1;
    ts = Math.max(now, ts);
    const base = {
      id: `${agentId}:${seq}`,
      agentId,
      seq,
      ts,
    };
    if (draft.scope === 'agent') {
      return { ...base, fact: draft };
    }
    const next = (turnSeq.get(draft.turnId) ?? 0) + 1;
    turnSeq.set(draft.turnId, next);
    return {
      ...base,
      fact: {
        scope: 'turn',
        turnId: draft.turnId,
        turnSeq: next,
        event: draft.event,
      },
    };
  });
}

interface SequenceState {
  lines: number;
  seq: number;
  ts: number;
  turnSeq: TurnSeqMap;
}

function parseBatches(
  raw: string,
  agentId: string,
  base?: SequenceState,
): { events: AgentEvent[]; lines: number } {
  const events: AgentEvent[] = [];
  const turnSeq: TurnSeqMap = new Map();
  let expectedSeq = (base?.seq ?? 0) + 1;
  let lastTs = base?.ts ?? 0;
  const lines = raw.split('\n');

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = (base?.lines ?? 0) + index + 1;
    if (line.trim().length === 0) continue;
    if (index === lines.length - 1 && !raw.endsWith('\n')) break;

    let rawBatch: unknown;
    try {
      rawBatch = JSON.parse(line);
    } catch {
      corrupt(`Agent 日志损坏：第 ${lineNumber} 行无法解析 JSON 行`);
    }
    if (!Array.isArray(rawBatch) || rawBatch.length === 0) {
      corrupt(`Agent 日志损坏：第 ${lineNumber} 行必须是非空事件批次`);
    }

    for (const rawEvent of rawBatch) {
      const parsed = AgentEventSchema.safeParse(rawEvent);
      if (!parsed.success) {
        const issues = parsed.error.issues.slice(0, 5).map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ');
        corrupt(`Agent 日志损坏：第 ${lineNumber} 行不符合 Agent 事件协议（${issues}）`);
      }
      const event = parsed.data;
      if (event.agentId !== agentId) corrupt('Agent 日志损坏：agentId 不匹配');
      if (event.seq !== expectedSeq) corrupt('Agent 日志损坏：Agent 序号不连续');
      if (event.id !== `${agentId}:${event.seq}`) corrupt('Agent 日志损坏：事件 id 非法');
      if (event.ts < lastTs) corrupt('Agent 日志损坏：时间戳倒退');
      if (event.fact.scope === 'turn') {
        const next = (turnSeq.get(event.fact.turnId) ?? base?.turnSeq.get(event.fact.turnId) ?? 0) + 1;
        if (event.fact.turnSeq !== next) corrupt('Agent 日志损坏：Turn 序号不连续');
        turnSeq.set(event.fact.turnId, next);
      }
      events.push(event);
      expectedSeq += 1;
      lastTs = event.ts;
    }
  }
  return { events, lines: (base?.lines ?? 0) + lines.length - 1 };
}

function dataOf(error: unknown): ErrorData {
  if (error instanceof ArcherError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    };
  }
  return {
    code: 'INTERNAL',
    message: error instanceof Error ? error.message : String(error),
  };
}

/** 内存实现；用于测试与临时运行 */
export class MemoryAgentJournal implements AgentJournal {
  private readonly logs = new Map<string, AgentEvent[]>();
  private readonly locks = new Map<string, Promise<unknown>>();

  private async withLock<T>(agentId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(agentId) ?? Promise.resolve();
    const next = previous.then(task, task);
    const guard = next.catch(() => undefined);
    this.locks.set(agentId, guard);
    try {
      return await next;
    } finally {
      if (this.locks.get(agentId) === guard) this.locks.delete(agentId);
    }
  }

  async ids(): Promise<readonly string[]> {
    return [...this.logs.keys()].sort();
  }

  async read(agentId: string, afterSeq = 0): Promise<readonly AgentEvent[]> {
    assertAgentId(agentId);
    return (this.logs.get(agentId) ?? [])
      .filter((event) => event.seq > afterSeq)
      .map((event) => structuredClone(event));
  }

  async append(input: AgentAppendInput): Promise<readonly AgentEvent[]> {
    assertAgentId(input.agentId);
    if (input.drafts.length === 0) {
      throw new ArcherError('INVALID_ARGUMENT', '事件批次不能为空');
    }
    return this.withLock(input.agentId, async () => {
      const log = this.logs.get(input.agentId) ?? [];
      const last = log.at(-1);
      if ((last?.seq ?? 0) !== input.expectedSeq) {
        throw new ArcherError('CONFLICT', 'Agent 日志基线已变化', {
          expectedSeq: input.expectedSeq,
          actualSeq: last?.seq ?? 0,
        });
      }
      const turnSeq: TurnSeqMap = new Map();
      for (const event of log) {
        if (event.fact.scope === 'turn') {
          turnSeq.set(event.fact.turnId, event.fact.turnSeq);
        }
      }
      const committed = assignDrafts(
        input.agentId,
        input.drafts,
        input.expectedSeq,
        last?.ts ?? 0,
        turnSeq,
        Date.now(),
      );
      log.push(...committed.map((event) => structuredClone(event)));
      this.logs.set(input.agentId, log);
      return committed;
    });
  }
}

interface ConfirmedTail extends SequenceState {
  bytes: number;
  digest: string;
  dev: bigint;
  ino: bigint;
}

/** 时间戳只是读取期间变化的附加检测，不能代替历史前缀的内容验证。 */
function sameFileVersion(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

/** JSONL 实现；内容摘要只复用已经校验的序号状态，不代替完整恢复。 */
export class JsonlAgentJournal implements AgentJournal {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly failedAgents = new Map<string, ErrorData>();
  private readonly tails = new Map<string, ConfirmedTail>();
  private readonly invalidAgents = new Map<string, ErrorData>();

  constructor(private readonly directory: string) {}

  private fileFor(agentId: string): string {
    assertAgentId(agentId);
    return path.join(this.directory, `${agentId}.jsonl`);
  }

  private async withLock<T>(agentId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(agentId) ?? Promise.resolve();
    const next = previous.then(task, task);
    const guard = next.catch(() => undefined);
    this.locks.set(agentId, guard);
    try {
      return await next;
    } finally {
      if (this.locks.get(agentId) === guard) this.locks.delete(agentId);
    }
  }

  async ids(): Promise<readonly string[]> {
    let entries: string[];
    try {
      entries = await readdir(this.directory);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    return entries
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => name.slice(0, -'.jsonl'.length))
      .filter((agentId) => AGENT_ID_PATTERN.test(agentId))
      .sort();
  }

  async read(agentId: string, afterSeq = 0): Promise<readonly AgentEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.fileFor(agentId), 'utf-8');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    // 恢复始终逐条校验全部完整批次；不以缓存替代事实，也不自动解除未知提交隔离。
    return parseBatches(raw, agentId).events.filter((event) => event.seq > afterSeq);
  }

  async append(input: AgentAppendInput): Promise<readonly AgentEvent[]> {
    assertAgentId(input.agentId);
    if (input.drafts.length === 0) {
      throw new ArcherError('INVALID_ARGUMENT', '事件批次不能为空');
    }
    return this.withLock(input.agentId, () => this.appendLocked(input));
  }

  private async appendLocked(input: AgentAppendInput): Promise<readonly AgentEvent[]> {
    const agentId = input.agentId;
    if (this.failedAgents.has(agentId)) {
      throw new ArcherError('COMMIT_UNKNOWN', '上一次提交结果未知，必须重新打开事件日志', { agentId });
    }
    const invalid = this.invalidAgents.get(agentId);
    if (invalid) throw new ArcherError('EVENT_LOG_CORRUPT', invalid.message, { agentId });
    const file = this.fileFor(agentId);
    const lockFile = `${file}.lock`;
    await mkdir(this.directory, { recursive: true });
    let writer: FileHandle;
    try {
      // 独占创建保护所有遵守此协议的进程。绝不按时间或 PID 自动抢占遗留锁。
      writer = await open(lockFile, 'wx');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new ArcherError('CONFLICT', 'Journal 正在提交或存在未处理的提交锁', {
          agentId, lockFile, reason: 'journal_writer_lock',
        });
      }
      throw error;
    }
    let handle: FileHandle | undefined;
    let writerClosed = false;
    let released = false;
    let writeStarted = false;
    let ownership: BigIntStats | undefined;
    try {
      ownership = await writer.stat({ bigint: true });
      await writer.writeFile(`${JSON.stringify({ pid: process.pid })}\n`, 'utf-8');
      handle = await open(file, 'a+');
      const before = await handle.stat({ bigint: true });
      const raw = await handle.readFile();
      const afterRead = await handle.stat({ bigint: true });
      if (!sameFileVersion(before, afterRead) || BigInt(raw.length) !== before.size) {
        corrupt('Agent 日志在读取期间发生变化');
      }
      const cached = this.tails.get(agentId);
      if (cached && (cached.dev !== before.dev || cached.ino !== before.ino || raw.length < cached.bytes)) {
        corrupt('Agent 日志已被替换或截断，必须重新打开并完整恢复');
      }
      // 每次读取并摘要完整已确认前缀，检测同尺寸改写与恢复 mtime 的外部修改。
      // 只缓存摘要和序号，不保留日志正文，也不信任 stat 命中即可跳过内容检查。
      const prefixBytes = cached?.bytes ?? 0;
      const hash = createHash('sha256').update(raw.subarray(0, prefixBytes));
      if (cached && hash.copy().digest('hex') !== cached.digest) {
        corrupt('Agent 日志已确认的历史内容发生变化');
      }
      const completeBytes = raw.lastIndexOf(10) + 1;
      if (completeBytes < prefixBytes) corrupt('Agent 日志已确认的批次边界发生变化');
      const suffix = raw.subarray(prefixBytes, completeBytes);
      const parsed = parseBatches(suffix.toString('utf-8'), agentId, cached);
      const events = parsed.events;
      const last = events.at(-1);
      const seq = last?.seq ?? cached?.seq ?? 0;
      if (seq !== input.expectedSeq) {
        throw new ArcherError('CONFLICT', 'Agent 日志基线已变化', {
          expectedSeq: input.expectedSeq, actualSeq: seq,
        });
      }
      // 仅为新增事实及本批草稿建立序号覆盖层，失败前不修改已确认的 Turn 状态。
      const changedTurns: TurnSeqMap = new Map();
      for (const event of events) {
        if (event.fact.scope === 'turn') changedTurns.set(event.fact.turnId, event.fact.turnSeq);
      }
      for (const draft of input.drafts) {
        if (draft.scope === 'turn' && !changedTurns.has(draft.turnId)) {
          changedTurns.set(draft.turnId, cached?.turnSeq.get(draft.turnId) ?? 0);
        }
      }
      const committed = assignDrafts(
        agentId,
        input.drafts,
        seq,
        last?.ts ?? cached?.ts ?? 0,
        changedTurns,
        Date.now(),
      );
      // 新事实同样必须能通过恢复协议，非法草稿在任何截断或追加之前拒绝。
      for (const event of committed) {
        if (!AgentEventSchema.safeParse(event).success) {
          throw new ArcherError('INVALID_ARGUMENT', '事件草稿不符合 Agent 事件协议');
        }
      }
      const payload = Buffer.from(`${JSON.stringify(committed)}\n`, 'utf-8');
      hash.update(suffix);
      const digest = hash.update(payload).digest('hex');
      const current = await stat(file, { bigint: true });
      const currentLock = await stat(lockFile, { bigint: true });
      if (!sameFileVersion(before, current) || currentLock.dev !== ownership.dev || currentLock.ino !== ownership.ino) {
        corrupt('Agent 日志或提交锁在提交前发生变化');
      }
      // 完整批次先全部校验，再修复未完成尾行；损坏的完整历史不能被修复动作掩盖。
      writeStarted = true;
      if (completeBytes !== raw.length) await handle.truncate(completeBytes);
      await handle.writeFile(payload);
      await handle.sync();
      const directory = await open(this.directory, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      const confirmed = await handle.stat({ bigint: true });
      const published = await stat(file, { bigint: true });
      if (!sameFileVersion(confirmed, published) || confirmed.dev !== before.dev || confirmed.ino !== before.ino
        || confirmed.size !== BigInt(completeBytes + payload.length)) {
        throw new Error('Agent 日志在提交期间发生变化');
      }
      await handle.close();
      handle = undefined;
      const finalLock = await stat(lockFile, { bigint: true });
      if (finalLock.dev !== ownership.dev || finalLock.ino !== ownership.ino) throw new Error('Journal 提交锁已变化');
      await writer.close();
      writerClosed = true;
      await unlink(lockFile);
      released = true;
      // 写入、双重同步、句柄关闭及解锁全部确认后，才推进摘要与序号缓存。
      const turnSeq = cached?.turnSeq ?? new Map<string, number>();
      for (const [turnId, value] of changedTurns) turnSeq.set(turnId, value);
      this.tails.set(agentId, {
        bytes: completeBytes + payload.length,
        digest,
        dev: confirmed.dev,
        ino: confirmed.ino,
        lines: parsed.lines + 1,
        seq: committed.at(-1)!.seq,
        ts: committed.at(-1)!.ts,
        turnSeq,
      });
      return committed;
    } catch (error: unknown) {
      if (error instanceof ArcherError && error.code === 'EVENT_LOG_CORRUPT') {
        this.invalidAgents.set(agentId, dataOf(error));
        this.tails.delete(agentId);
      }
      if (writeStarted) {
        // 可能已经落盘的写入不推进确认缓存，也不自动重试；遗留锁要求显式恢复处理。
        this.tails.delete(agentId);
        this.failedAgents.set(agentId, dataOf(error));
        throw new ArcherError('COMMIT_UNKNOWN', 'Agent 日志提交结果未知', { agentId });
      }
      throw error;
    } finally {
      await handle?.close().catch(() => {});
      if (!writerClosed) await writer.close().catch(() => {});
      // 尚未开始写入时可以释放本次占有；未知提交和异常退出不能自动解锁。
      if (!writeStarted && !released && ownership) {
        const remaining = await stat(lockFile, { bigint: true }).catch(() => undefined);
        if (remaining?.dev === ownership.dev && remaining.ino === ownership.ino) {
          await unlink(lockFile).catch(() => {});
        }
      }
    }
  }
}
