/** 文件工具使用显式工作环境。 */
import * as path from 'node:path';
import type { KernelError, FileAccess, Result, Workspace } from '@archer/contracts';
import { LocalFilesystem } from './local-filesystem.js';

/** 创建时检查配置，不改变声明中的路径，恢复时仍按原配置接入。 */
export function validateWorkspace(workspace: Workspace): void {
  if (!path.isAbsolute(workspace.cwd)) throw new Error('Workspace cwd must be an absolute path.');
  new LocalFilesystem(workspace.cwd);
}

/** 每次执行创建独立作用域，底层受控队列跨环境共享；不捕获其他 Agent 的目录。 */
export function workspaceFiles(workspace: Workspace, signal: AbortSignal): FileAccess {
  let filesystem: LocalFilesystem | undefined;
  const backend = () => filesystem ??= new LocalFilesystem(workspace.cwd);
  const relative = (input: string): string => {
    if (input.includes('\0') || input.includes('\\') || input.split('/').includes('..')) {
      throw new Error('Invalid workspace file path.');
    }
    const configured = path.resolve(workspace.cwd);
    let value = input;
    if (path.isAbsolute(input)) {
      const logical = path.relative(configured, input);
      value = !path.isAbsolute(logical) && !logical.split(path.sep).includes('..')
        ? logical
        : path.relative(backend().rootDir, input);
    }
    if (path.isAbsolute(value) || value.split(path.sep).includes('..')) throw new Error('File path escapes workspace.');
    return value === '.' ? '' : value.replace(/^\.\//, '').replace(/\/$/, '');
  };
  const attempt = async <T>(operation: () => Promise<T>): Promise<Result<T, KernelError>> => {
    try {
      if (signal.aborted) throw new Error('File operation was cancelled.');
      return { ok: true, value: await operation() };
    } catch (error) {
      return { ok: false, error: { code: 'PROVIDER_ERROR', message: error instanceof Error ? error.message : String(error) } };
    }
  };
  return {
    inspect: input => attempt(async () => {
      const target = relative(input);
      if ((await backend().stat(target))?.kind !== 'file') throw new Error(`Not a file: ${input}`);
      return backend().inspect(target, signal);
    }),
    list: input => attempt(async () => {
      const target = relative(input);
      if ((await backend().stat(target))?.kind !== 'dir') throw new Error(`Not a directory: ${input}`);
      return backend().list(target, signal);
    }),
    write: async (input, content, expectedRevision) => {
      if (workspace.access !== 'edit') return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'Workspace is read-only.' } };
      const prepared = await attempt(async () => ({ target: relative(input), filesystem: backend() }));
      if (!prepared.ok) return prepared;
      // 写入窗口中的异常必须向 Runtime 传播，不转换为确定性拒绝。
      const result = await prepared.value.filesystem.write(prepared.value.target, { content, expectedRevision }, signal);
      if (!result.ok) {
        if (result.error.code === 'UNKNOWN_SIDE_EFFECT') throw new Error(result.error.message);
        return { ok: false, error: result.error };
      }
      return { ok: true, value: result };
    },
  };
}
