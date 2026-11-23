/**
 * Archer Harness — Node Shell provider
 *
 * 提供宿主 Shell 执行后端：
 *   - 命令工作目录限制在工作目录边界内；
 *   - 继承宿主进程环境，允许显式覆盖；
 *   - 支持 AbortSignal 与超时；
 *   - 不提供文件系统、进程或网络隔离。
 */

import { exec } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import * as path from 'node:path';
import type { JsonValue, SchemaDescriptor } from '@archer/contracts';
import { OperationRejected } from '@archer/contracts';
import {
  SHELL_CANCELLED_OR_TIMEOUT,
  SHELL_COMMAND_EMPTY,
  SHELL_OPERATION_CANCELLED,
  SHELL_PAYLOAD_INVALID,
  SHELL_SCHEMA,
  SHELL_TIMEOUT_INVALID,
  shellCwdEscapesRoot,
  shellCwdNotDirectory,
  shellCwdNotFound,
  shellCwdSymlinkEscape,
  shellExitCodeLine,
} from './tools/prompt.js';

export interface ShellProviderOptions {
  /** 默认超时，毫秒 */
  timeoutMs?: number;
  /** 最大输出缓冲，字节 */
  maxBuffer?: number;
  /** 覆盖继承的宿主进程环境变量 */
  env?: NodeJS.ProcessEnv;
}

interface ShellPayload {
  command: string;
  cwd?: string;
  timeout?: number;
}

function parsePayload(payload: unknown): ShellPayload {
  if (typeof payload === 'string') {
    const command = payload.trim();
    if (command.length === 0) throw new Error(SHELL_COMMAND_EMPTY);
    return { command };
  }
  if (payload && typeof payload === 'object' && 'command' in payload) {
    const record = payload as Record<string, unknown>;
    const command = String(record.command ?? '').trim();
    if (command.length === 0) throw new Error(SHELL_COMMAND_EMPTY);
    const cwd = record.cwd === undefined ? undefined : String(record.cwd);
    const timeout = record.timeout === undefined ? undefined : Number(record.timeout);
    if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
      throw new Error(SHELL_TIMEOUT_INVALID);
    }
    return {
      command,
      ...(cwd !== undefined ? { cwd } : {}),
      ...(timeout !== undefined ? { timeout } : {}),
    };
  }
  throw new Error(SHELL_PAYLOAD_INVALID);
}

function within(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

export class ShellProvider {
  readonly rootDir: string;
  private readonly defaultTimeoutMs: number;
  private readonly maxBuffer: number;
  private readonly extraEnv: NodeJS.ProcessEnv;

  constructor(rootDir: string, options: ShellProviderOptions = {}) {
    if (!path.isAbsolute(rootDir)) {
      throw new Error(`ShellProvider 工作目录必须是绝对路径：${rootDir}`);
    }
    this.rootDir = realpathSync(rootDir);
    if (!statSync(this.rootDir).isDirectory()) {
      throw new Error(`ShellProvider 工作目录不是目录：${rootDir}`);
    }
    this.defaultTimeoutMs = options.timeoutMs ?? 30_000;
    this.maxBuffer = options.maxBuffer ?? 10 * 1024 * 1024;
    this.extraEnv = options.env ?? {};
  }

  /** 提供给 Tool Contract 的载荷 schema */
  get schema(): SchemaDescriptor {
    return SHELL_SCHEMA;
  }

  private environment(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...this.extraEnv,
    };
  }

  async execute(input: unknown, signal: AbortSignal): Promise<JsonValue> {
    if (signal.aborted) throw new OperationRejected(SHELL_OPERATION_CANCELLED, 'INTERNAL');
    let payload: ShellPayload;
    try {
      payload = parsePayload(input);
    } catch (error: unknown) {
      throw new OperationRejected(error instanceof Error ? error.message : String(error), 'PROVIDER_ERROR');
    }

    let cwd = this.rootDir;
    if (payload.cwd !== undefined) {
      const candidate = path.resolve(this.rootDir, payload.cwd);
      if (!within(this.rootDir, candidate)) {
        throw new OperationRejected(shellCwdEscapesRoot(payload.cwd), 'PATH_INVALID');
      }
      try {
        if (!statSync(candidate).isDirectory()) {
          throw new OperationRejected(shellCwdNotDirectory(payload.cwd), 'NOT_A_FILE');
        }
        const real = realpathSync(candidate);
        if (!within(this.rootDir, real)) {
          throw new OperationRejected(shellCwdSymlinkEscape(payload.cwd), 'PATH_INVALID');
        }
        cwd = real;
      } catch (error) {
        if (error instanceof OperationRejected) throw error;
        throw new OperationRejected(shellCwdNotFound(payload.cwd), 'NOT_FOUND');
      }
    }

    const timeout = Math.max(
      1,
      Math.min(payload.timeout ?? this.defaultTimeoutMs, 5 * 60 * 1000),
    );

    const result = await new Promise<{
      stdout: string;
      stderr: string;
      exitCode: number;
      killed: boolean;
      spawnError: string | null;
    }>((resolve) => {
      exec(
        payload.command,
        {
          cwd,
          timeout,
          maxBuffer: this.maxBuffer,
          env: this.environment(),
          signal,
        },
        (error, stdout, stderr) => {
          const execError = error as
            | (Error & { code?: number | string; killed?: boolean })
            | null;
          if (execError && execError.killed) {
            resolve({
              stdout: stdout ?? '',
              stderr: stderr ?? '',
              exitCode: 124,
              killed: true,
              spawnError: null,
            });
            return;
          }
          if (execError && typeof execError.code === 'number') {
            resolve({
              stdout: stdout ?? '',
              stderr: stderr ?? '',
              exitCode: execError.code,
              killed: false,
              spawnError: null,
            });
            return;
          }
          if (execError) {
            resolve({
              stdout: stdout ?? '',
              stderr: stderr ?? '',
              exitCode: 1,
              killed: false,
              spawnError: execError.message,
            });
            return;
          }
          resolve({
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            exitCode: 0,
            killed: false,
            spawnError: null,
          });
        },
      );
    });

    if (result.killed) {
      throw new Error(SHELL_CANCELLED_OR_TIMEOUT);
    }
    if (result.spawnError !== null) {
      throw new Error(result.spawnError);
    }

    const output = [
      `$ ${payload.command}`,
      result.stdout,
      result.stderr,
      shellExitCodeLine(result.exitCode),
    ]
      .filter((part) => part.length > 0)
      .join('\n');

    return {
      output,
      isError: result.exitCode !== 0,
      metadata: { command: { command: payload.command, cwd, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode } },
    };
  }
}
