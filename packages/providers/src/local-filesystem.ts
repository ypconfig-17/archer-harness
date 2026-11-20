/**
 * Archer Harness — 本地工作环境文件后端
 *
 * 文件工具的本地执行后端，关键约束：
 *   - 只接收工作目录内相对路径；
 *   - 拒绝 `..`、绝对路径、反斜杠与 NUL；
 *   - 所有实际路径都做 realpath + 前缀校验，防止 symlink 逃逸；
 *   - description 不暴露宿主机路径；
 *   - 目录不可写，创建文件走子路径。
 */

import { readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import type {
  FileReadResult,
  KernelError,
  FileWriteInput,
  FileWriteResult,
  FileStat,
  Result,
} from '@archer/contracts';
import { TOOL_OPERATION_CANCELLED, directoryNotWritable, fileAlreadyExists, fileNotFound, parentNotDirectory, parentNotFound, revisionMismatch } from './tools/prompt.js';
import { FS_ROOT_DESCRIPTION, FS_EMPTY_DIRECTORY, FS_PATH_INVALID_CHARACTERS, FS_WRITE_UNREADABLE, fsBinaryFile, fsNotRegularFile, fsEntryDescription, fsFileTooLarge, fsListingLine, fsParentEscapesRoot, fsPathEscapesRoot, fsPathInvalidSegment, fsPathMustBeRelative, fsSymlinkEscapesRoot, fsWriteOutput } from './tools/prompt.js';
import type { FileEntry } from '@archer/contracts';

export interface LocalFilesystemOptions {
  /** 单文件读取上限，默认 1 MiB */
  maxFileBytes?: number;
}

interface HostStat {
  isDirectory: boolean;
  isFile: boolean;
  size: number;
  mtimeMs: number;
}

/** 准备阶段只读取与校验；此对象不表示已经调用宿主写入。 */
interface PreparedFileWrite {
  hostPath: string;
  content: string;
  revisionBefore: string | null;
  createOnly: boolean;
  before?: string | null;
}

function fail(code: KernelError['code'], message: string, details?: Record<string, unknown>): KernelError {
  return { code, message, ...(details ? { details } : {}) };
}

/** 写入调用开始后，异常只能表达结果未知，不能证明宿主没有改变文件。 */
function unknownWrite(error: unknown): FileWriteResult {
  return { ok: false, error: fail('UNKNOWN_SIDE_EFFECT', error instanceof Error ? error.message : String(error)) };
}

/** 内容 revision 不依赖进程计数、工具地址或文件时间，重新接入后仍可比较。 */
function contentRevision(kind: 'file' | 'dir', content: string | Uint8Array): string {
  return `fs:${kind}:${createHash('sha256').update(content).digest('hex')}`;
}

/**
 * 所有 LocalFilesystem 实例共享受控访问边界，涵盖多个工作环境、重叠根及链接别名。
 *
 * 仅按路径加锁无法覆盖硬链接；当前使用同进程单队列，以牺牲独立文件并行度
 * 换取明确的读写顺序。队列不是持久化状态，也不约束 Shell 或其他进程。
 * 临界区中的私有方法不能再次调用公共文件方法，避免重入等待自身。
 */
let filesystemAccess: Promise<void> = Promise.resolve();

function withFilesystemAccess<T>(operation: () => Promise<T>): Promise<T> {
  const result = filesystemAccess.then(operation);
  filesystemAccess = result.then(() => undefined, () => undefined);
  return result;
}

/** 判断 path 是否位于 root 内（含 root） */
function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

export class LocalFilesystem {
  private readonly root: string;
  private readonly maxFileBytes: number;

  constructor(rootDir: string, options: LocalFilesystemOptions = {}) {
    if (!path.isAbsolute(rootDir)) {
      throw new Error(`LocalFilesystem 根目录必须是绝对路径：${rootDir}`);
    }
    this.root = realpathSync(rootDir);
    if (!statSync(this.root).isDirectory()) {
      throw new Error(`LocalFilesystem 根目录不是目录：${rootDir}`);
    }
    this.maxFileBytes = options.maxFileBytes ?? 1024 * 1024;
  }

  /** 已校验的宿主工作根目录 */
  get rootDir(): string {
    return this.root;
  }

  private resolveHost(relativePath: string): string {
    if (relativePath.includes('\0') || relativePath.includes('\\')) {
      throw new Error(FS_PATH_INVALID_CHARACTERS);
    }
    if (relativePath.startsWith('/')) {
      throw new Error(fsPathMustBeRelative(relativePath));
    }
    if (relativePath === '') return this.root;

    const segments = relativePath.split('/');
    for (const segment of segments) {
      if (segment === '' || segment === '.' || segment === '..') {
        throw new Error(fsPathInvalidSegment(relativePath));
      }
    }

    const hostPath = path.resolve(this.root, ...segments);
    if (!within(this.root, hostPath)) {
      throw new Error(fsPathEscapesRoot(relativePath));
    }
    return hostPath;
  }

  /**
   * 校验 realpath 仍位于工作根内。
   * 错误信息只使用工作目录内路径，避免把宿主机路径带进模型上下文。
   */
  private async assertRealPath(hostPath: string, displayPath: string): Promise<void> {
    const real = await realpath(hostPath);
    if (!within(this.root, real)) {
      throw new Error(fsSymlinkEscapesRoot(displayPath));
    }
  }

  private async statHost(hostPath: string): Promise<HostStat | null> {
    try {
      const info = await stat(hostPath);
      return {
        isDirectory: info.isDirectory(),
        isFile: info.isFile(),
        size: info.size,
        mtimeMs: info.mtimeMs,
      };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /** stat 与条件写入需要完整内容摘要；流式读取避免按文件大小分配内存。 */
  private async fileRevision(hostPath: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(hostPath)) hash.update(chunk);
    return `fs:file:${hash.digest('hex')}`;
  }

  /** 目录 revision 对应其可读取的成员索引，不代表后代文件的内容版本。 */
  private async directorySnapshot(hostPath: string): Promise<{ content: string; entryCount: number }> {
    const entries = await readdir(hostPath, { withFileTypes: true });
    const visible = entries
      .filter((entry) => entry.isFile() || entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      content: visible.map((entry) => fsListingLine(entry.name, entry.isDirectory())).join('\n') || FS_EMPTY_DIRECTORY,
      entryCount: visible.length,
    };
  }

  stat(relativePath: string): Promise<FileStat | null> {
    return withFilesystemAccess(() => this.statNode(relativePath));
  }

  private async statNode(relativePath: string): Promise<FileStat | null> {
    const hostPath = this.resolveHost(relativePath);
    const info = await this.statHost(hostPath);
    if (!info) return null;
    await this.assertRealPath(hostPath, relativePath || '/');
    if (!info.isDirectory && !info.isFile) return null;
    const revision = info.isDirectory
      ? contentRevision('dir', (await this.directorySnapshot(hostPath)).content)
      : await this.fileRevision(hostPath);

    return {
      kind: info.isDirectory ? 'dir' : 'file',
      revision,

      ...(relativePath === '' ? { description: FS_ROOT_DESCRIPTION } : {}),
    };
  }

  list(
    relativePath: string,
    signal: AbortSignal,
  ): Promise<readonly FileEntry[]> {
    return withFilesystemAccess(() => this.listNode(relativePath, signal));
  }

  private async listNode(relativePath: string, signal: AbortSignal): Promise<readonly FileEntry[]> {
    if (signal.aborted) return [];
    const hostPath = this.resolveHost(relativePath);
    const info = await this.statHost(hostPath);
    if (!info || !info.isDirectory) return [];
    await this.assertRealPath(hostPath, relativePath || '/');

    const entries = await readdir(hostPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() || entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? ('dir' as const) : ('file' as const),

        description: fsEntryDescription(entry.name, entry.isDirectory()),
      }));
  }

  inspect(relativePath: string, signal: AbortSignal): Promise<FileReadResult> {
    return withFilesystemAccess(() => this.inspectNode(relativePath, signal));
  }

  private async inspectNode(relativePath: string, signal: AbortSignal): Promise<FileReadResult> {
    if (signal.aborted) throw new Error(TOOL_OPERATION_CANCELLED);

    const hostPath = this.resolveHost(relativePath);
    const info = await this.statHost(hostPath);
    if (!info) throw new Error(fileNotFound(relativePath));
    await this.assertRealPath(hostPath, relativePath);
    if (info.isDirectory) {
      const snapshot = await this.directorySnapshot(hostPath);
      return {
        content: snapshot.content,
        revision: contentRevision('dir', snapshot.content),
        metadata: { entryCount: snapshot.entryCount },
      };
    }
    if (!info.isFile) throw new Error(fsNotRegularFile(relativePath));

    if (info.size > this.maxFileBytes) {
      throw new Error(
        fsFileTooLarge(info.size, this.maxFileBytes, relativePath),
      );
    }

    const bytes = await readFile(hostPath);
    if (bytes.length > this.maxFileBytes) {
      throw new Error(fsFileTooLarge(bytes.length, this.maxFileBytes, relativePath));
    }
    const content = bytes.toString('utf-8');
    if (content.includes('\0')) {
      throw new Error(fsBinaryFile(relativePath));
    }

    return {
      content,
      revision: contentRevision('file', bytes),
      metadata: { sizeBytes: bytes.length, modifiedAt: new Date(info.mtimeMs).toISOString() },
    };
  }

  write(
    relativePath: string,
    input: FileWriteInput,
    signal: AbortSignal,
  ): Promise<FileWriteResult> {
    return withFilesystemAccess(() => this.writeNode(relativePath, input, signal));
  }

  private async writeNode(
    relativePath: string,
    input: FileWriteInput,
    signal: AbortSignal,
  ): Promise<FileWriteResult> {
    if (signal.aborted) {
      return {
        ok: false,
        error: fail('INTERNAL', TOOL_OPERATION_CANCELLED),
      };
    }

    let prepared: Result<PreparedFileWrite>;
    try {
      prepared = await this.prepareWrite(relativePath, input);
    } catch (error: unknown) {
      // 尚未调用 writeFile，检查失败可以确定为本次未写入。
      return { ok: false, error: fail('PROVIDER_ERROR', error instanceof Error ? error.message : String(error)) };
    }
    if (!prepared.ok) return prepared;
    // 准备过程有异步读取；取消可能在此期间到达，进入写入窗口前再检查一次。
    if (signal.aborted) return { ok: false, error: fail('INTERNAL', TOOL_OPERATION_CANCELLED) };
    return this.performWrite(prepared.value, relativePath);
  }

  /** 所有前置条件在受控队列中检查；此阶段不发起文件写入。 */
  private async prepareWrite(relativePath: string, input: FileWriteInput): Promise<Result<PreparedFileWrite>> {
    const hostPath = this.resolveHost(relativePath);
    const current = await this.statHost(hostPath);
    if (current) await this.assertRealPath(hostPath, relativePath);

    if (current?.isDirectory) {
      return {
        ok: false,
        error: fail('NOT_A_FILE', directoryNotWritable(relativePath)),
      };
    }

    if (input.expectedRevision === null && current) {
      return {
        ok: false,
        error: fail('ALREADY_EXISTS', fileAlreadyExists(relativePath)),
      };
    }
    // 特殊文件不进入摘要或写入，避免 FIFO 等节点占住整个受控访问队列。
    if (current && !current.isFile) {
      return { ok: false, error: fail('NOT_A_FILE', fsNotRegularFile(relativePath)) };
    }
    // 原文与 revision 从同一次读取产生，防止回执配上另一次读取的版本。
    // 只保留有界文本；超限和二进制不伪造空原文，仍流式计算完整 CAS 摘要。
    let before: string | null | undefined = current ? undefined : null;
    let revisionBefore: string | null = null;
    if (current) {
      const hash = createHash('sha256');
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of createReadStream(hostPath)) {
        const bytes = Buffer.from(chunk);
        hash.update(bytes);
        size += bytes.length;
        if (size <= 256 * 1024) chunks.push(bytes);
        else chunks.length = 0;
      }
      revisionBefore = `fs:file:${hash.digest('hex')}`;
      if (size <= 256 * 1024) {
        const bytes = Buffer.concat(chunks);
        if (!bytes.includes(0)) before = bytes.toString('utf8');
      }
    }
    if (
      typeof input.expectedRevision === 'string' &&
      revisionBefore !== input.expectedRevision
    ) {
      return {
        ok: false,
        error: fail('REVISION_CONFLICT', revisionMismatch(relativePath), {
          expectedRevision: input.expectedRevision,
          actualRevision: revisionBefore,
        }),
      };
    }

    if (!current) {
      const parentHost = path.dirname(hostPath);
      if (!within(this.root, parentHost)) {
        return {
          ok: false,
          error: fail('PATH_INVALID', fsParentEscapesRoot(relativePath)),
        };
      }
      const parent = await this.statHost(parentHost);
      if (!parent) {
        return {
          ok: false,
          error: fail('PARENT_NOT_FOUND', parentNotFound(relativePath)),
        };
      }
      if (!parent.isDirectory) {
        return {
          ok: false,
          error: fail(
            'PARENT_NOT_A_DIRECTORY',
            parentNotDirectory(relativePath),
          ),
        };
      }
      await this.assertRealPath(parentHost, relativePath);
    }

    const content = input.content;
    if (typeof content !== 'string') throw new Error('File content must be a string.');

    return { ok: true, value: { hostPath, content, revisionBefore, before, createOnly: input.expectedRevision === null } };
  }

  /** writeFile 与写后确认都位于结果未知窗口，只有排他创建的 EEXIST 可以确定拒绝。 */
  private async performWrite(prepared: PreparedFileWrite, displayPath: string): Promise<FileWriteResult> {
    const { hostPath, content, revisionBefore, createOnly } = prepared;
    try {
      await writeFile(hostPath, content, {
        encoding: 'utf-8',
        flag: createOnly ? 'wx' : 'w',
      });
    } catch (error: unknown) {
      if (createOnly && (error as NodeJS.ErrnoException).code === 'EEXIST') {
        return {
          ok: false,
          error: fail('ALREADY_EXISTS', fileAlreadyExists(displayPath)),
        };
      }
      return unknownWrite(error);
    }

    try {
      const updated = await this.statHost(hostPath);
      if (!updated?.isFile) return unknownWrite(FS_WRITE_UNREADABLE);
      await this.assertRealPath(hostPath, displayPath);
      return {
        ok: true,
        output: fsWriteOutput(displayPath, Buffer.byteLength(content, 'utf-8')),
        revisionBefore,
        ...(prepared.before !== undefined ? { metadata: { before: prepared.before } } : {}),
        revisionAfter: await this.fileRevision(hostPath),
      };
    } catch (error: unknown) {
      // 即使错误码是 EEXIST，写后确认失败也不能被当成排他创建前的拒绝。
      return unknownWrite(error);
    }
  }
}
