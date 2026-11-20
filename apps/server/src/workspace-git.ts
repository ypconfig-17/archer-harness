/**
 * 工作区 Git 读取。
 *
 * 只运行固定的只读 Git 命令，读取 HEAD 与当前文件的两侧内容；
 * 不执行工作区代码、不触发外部 diff 驱动，也不写入任何任务事实。
 */

import { execFile } from 'node:child_process';
import { lstat, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceGitChanges, WorkspaceGitFile } from '@archer/contracts';

const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;
/** 单个文件超过该体积时不再传原文，避免把巨大文件塞进界面与 HTTP 响应。 */
const MAX_FILE_BYTES = 256 * 1024;
/** 单次最多列出的文件数；其余只报告数量。 */
const MAX_FILES = 200;
/** 一次响应中原文内容的总预算。 */
const MAX_CONTENT_BYTES = 2 * 1024 * 1024;

export interface GitStatusEntry {
  index: string;
  worktree: string;
  path: string;
  previousPath?: string;
}

type ContentSide = {
  content?: string;
  binary?: boolean;
  truncated?: boolean;
};

class GitCommandError extends Error {
  readonly code?: string;

  constructor(message: string, readonly stderr: string, code?: string) {
    super(message);
    this.name = 'GitCommandError';
    this.code = code;
  }
}

/** 解析 `git status --porcelain=v1 -z`；重命名/复制记录后紧跟原路径。 */
export function parseGitStatus(output: string): GitStatusEntry[] {
  const entries: GitStatusEntry[] = [];
  const records = output.split('\0');
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const entryIndex = record[0]!;
    const worktree = record[1]!;
    const filePath = record.slice(3);
    let previousPath: string | undefined;
    if (entryIndex === 'R' || entryIndex === 'C' || worktree === 'R' || worktree === 'C') {
      previousPath = records[++index];
    }
    entries.push({
      index: entryIndex,
      worktree,
      path: filePath,
      ...(previousPath ? { previousPath } : {}),
    });
  }
  return entries;
}

/** 读取工作区未提交改动；缺少工作区或仓库时返回可展示的原因，不抛错。 */
export async function readWorkspaceGitChanges(cwd: string | undefined, scope: 'all' | 'staged' | 'unstaged' = 'all', selectedPath?: string): Promise<WorkspaceGitChanges> {
  if (!cwd) return { available: false, reason: 'no-workspace', detail: '会话没有记录工作区目录' };
  let root: string;
  try {
    root = (await runGitText(cwd, ['rev-parse', '--show-toplevel'])).trim();
  } catch (error) {
    if (isMissingGit(error)) {
      return { available: false, reason: 'git-unavailable', detail: '未找到 git 命令' };
    }
    return { available: false, reason: 'not-a-repository', detail: `无法读取 Git 仓库：${messageOf(error)}` };
  }
  if (!root) return { available: false, reason: 'not-a-repository', detail: '工作区没有 Git 仓库根目录' };

  const branch = await currentBranch(root);
  const hasHead = await headExists(root);
  let status: string;
  try {
    status = await runGitText(root, ['status', '--porcelain=v1', '-z', '--untracked-files=normal']);
  } catch (error) {
    return { available: false, reason: 'read-failed', detail: `读取 Git 状态失败：${messageOf(error)}` };
  }

  // 范围决定状态语义，避免暂存新增文件在未暂存视图仍标成新增。
  const entries = parseGitStatus(status).filter(entry => scope === 'all'
    || (scope === 'staged' ? entry.index !== ' ' && entry.index !== '?'
      : entry.worktree !== ' ')).map(entry => scope === 'all' ? entry : {
        ...entry,
        index: scope === 'unstaged' && entry.index !== '?' ? ' ' : entry.index,
        worktree: scope === 'staged' ? ' ' : entry.worktree,
      });
  const files: WorkspaceGitFile[] = [];
  let used = 0;
  for (const entry of entries.slice(0, MAX_FILES)) {
    // 列表不读取全文；详情路径只能命中 Git 已列出的条目。
    const file = selectedPath === entry.path
      ? await readEntry(root, entry, hasHead, MAX_CONTENT_BYTES - used, scope)
      : { path: entry.path, status: gitStatusKind(entry), staged: entry.index !== ' ' && entry.index !== '?',
          workingTree: entry.worktree !== ' ', binary: false, truncated: false };
    used += (file.before?.length ?? 0) + (file.after?.length ?? 0);
    files.push(file);
  }
  return {
    available: true,
    root,
    ...(branch ? { branch } : {}),
    files,
    omitted: Math.max(0, entries.length - files.length),
  };
}

async function readEntry(
  root: string,
  entry: GitStatusEntry,
  hasHead: boolean,
  budget: number,
  scope: 'all' | 'staged' | 'unstaged',
): Promise<WorkspaceGitFile> {
  const status = gitStatusKind(entry);
  const staged = entry.index !== ' ' && entry.index !== '?';
  const workingTree = entry.worktree !== ' ';
  let before: ContentSide;
  let after: ContentSide;
  if (scope === 'staged') {
    before = entry.index === 'A' ? { content: '' } : await readBlob(root, `HEAD:${entry.previousPath ?? entry.path}`, hasHead);
    after = entry.index === 'D' ? { content: '' } : await readBlob(root, `:${entry.path}`, true);
  } else if (scope === 'unstaged' && status !== 'untracked') {
    before = await readBlob(root, `:${entry.path}`, true);
    after = entry.worktree === 'D' ? { content: '' } : await readWorktree(root, entry.path);
  } else if (status === 'untracked') {
    before = { content: '' };
    after = await readWorktree(root, entry.path);
  } else if (status === 'deleted') {
    before = await readBlob(root, `HEAD:${entry.path}`, hasHead);
    after = { content: '' };
  } else if (status === 'added') {
    before = { content: '' };
    after = await readWorktree(root, entry.path);
  } else {
    before = await readBlob(root, `HEAD:${entry.previousPath ?? entry.path}`, hasHead);
    after = await readWorktree(root, entry.path);
  }
  const binary = Boolean(before.binary || after.binary);
  const beyondLimit = Boolean(before.truncated || after.truncated)
    || Buffer.byteLength(before.content ?? '') + Buffer.byteLength(after.content ?? '') > budget;
  const file: WorkspaceGitFile = {
    path: entry.path,
    ...(entry.previousPath ? { previousPath: entry.previousPath } : {}),
    status,
    staged,
    workingTree,
    binary,
    truncated: !binary && beyondLimit,
  };
  if (binary || file.truncated) return file;
  // 无法读取的一侧保持缺省，不用空字符串冒充原文。
  if (before.content !== undefined) file.before = before.content;
  if (after.content !== undefined) file.after = after.content;
  return file;
}

function gitStatusKind(entry: GitStatusEntry): WorkspaceGitFile['status'] {
  const { index, worktree } = entry;
  if (index === '?' && worktree === '?') return 'untracked';
  // 未合并标记优先于单侧增删，冲突文件不能显示成普通修改。
  if (index === 'U' || worktree === 'U'
    || (index === 'A' && worktree === 'A') || (index === 'D' && worktree === 'D')) {
    return 'conflicted';
  }
  if (index === 'R' || worktree === 'R') return 'renamed';
  if (index === 'C' || worktree === 'C') return 'copied';
  if (index === 'A' || worktree === 'A') return 'added';
  if (index === 'D' || worktree === 'D') return 'deleted';
  if (index === 'T' || worktree === 'T') return 'typechange';
  return 'modified';
}

async function readBlob(root: string, revPath: string, hasHead: boolean): Promise<ContentSide> {
  // 尚无提交时 HEAD 侧确认为空；其余读取失败保持缺省。
  if (!hasHead) return { content: '' };
  try {
    const size = Number((await runGitText(root, ['cat-file', '-s', revPath])).trim());
    if (!Number.isFinite(size)) return {};
    if (size > MAX_FILE_BYTES) return { truncated: true };
    const { stdout } = await runGit(root, ['cat-file', 'blob', revPath]);
    return decodeContent(stdout);
  } catch {
    return {};
  }
}

async function readWorktree(root: string, relPath: string): Promise<ContentSide> {
  const target = path.resolve(root, relPath);
  // porcelain 路径来自仓库自身；仍做边界检查，避免符号链接或异常路径读到仓库外。
  if (target !== root && !target.startsWith(root + path.sep)) return {};
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink()) return { content: await readlink(target) };
    if (!info.isFile()) return {};
    if (info.size > MAX_FILE_BYTES) return { truncated: true };
    return decodeContent(await readFile(target));
  } catch {
    return {};
  }
}

function decodeContent(buffer: Buffer): ContentSide {
  // 前 8 KiB 出现 NUL 视为二进制，不把二进制内容解码成可读文本。
  if (buffer.subarray(0, 8192).includes(0)) return { binary: true };
  return { content: buffer.toString('utf8') };
}

async function currentBranch(root: string): Promise<string | undefined> {
  try {
    const branch = (await runGitText(root, ['branch', '--show-current'])).trim();
    return branch || undefined;
  } catch {
    return undefined;
  }
}

async function headExists(root: string): Promise<boolean> {
  try {
    await runGitText(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

function runGitText(cwd: string, args: readonly string[]): Promise<string> {
  return runGit(cwd, args).then(result => result.stdout.toString('utf8'));
}

function runGit(cwd: string, args: readonly string[]): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, '--no-pager', ...args], {
      encoding: 'buffer',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
    }, (error, stdout, stderr) => {
      if (error) {
        const code = (error as NodeJS.ErrnoException).code;
        reject(new GitCommandError(error.message, stderr.toString('utf8'), code));
        return;
      }
      resolve({ stdout, stderr: stderr.toString('utf8') });
    });
  });
}

function isMissingGit(error: unknown): boolean {
  return error instanceof GitCommandError && error.code === 'ENOENT';
}

function messageOf(error: unknown): string {
  if (error instanceof GitCommandError) return error.stderr.trim() || error.message;
  return error instanceof Error ? error.message : String(error);
}
