/**
 * Archer Harness — Shell 执行沙箱与环境变量隔离
 *
 * 在宿主进程之外提供可选的 OS 级边界：
 * - `envMode: 'minimal'` 剥离敏感宿主凭证，仅透传基础环境变量白名单；
 * - `mode: 'os'` 在 macOS 使用系统自带 `sandbox-exec`（Seatbelt）限制文件写入边界与网络访问；
 * - 非支持平台显式拒绝，绝不静默降级为无沙箱裸跑。
 */

import { existsSync, realpathSync } from 'node:fs';
import { OperationRejected } from '@archer/contracts';

export type ShellSandboxMode = 'none' | 'os';
export type ShellEnvMode = 'inherit' | 'minimal';

export interface ShellSandboxOptions {
  /** 沙箱模式：`'none'` 为宿主直跑（默认），`'os'` 启用操作系统级沙箱 */
  mode?: ShellSandboxMode;
  /** 是否允许网络访问；在 `'os'` 模式下默认为 `false` */
  allowNetwork?: boolean;
  /** 只读工作区模式：开启后即使在工作区目录内也禁止写入 */
  readOnly?: boolean;
  /** 额外允许写入的目录路径 */
  allowWritePaths?: readonly string[];
}

const MINIMAL_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TZ',
] as const;

/** 构建子进程环境变量；`minimal` 模式只透传安全基础白名单与显式覆盖值。 */
export function buildShellEnv(
  baseEnv: NodeJS.ProcessEnv,
  extraEnv: NodeJS.ProcessEnv,
  envMode: ShellEnvMode,
  allowEnv: readonly string[] = [],
): NodeJS.ProcessEnv {
  if (envMode === 'inherit') {
    return { ...baseEnv, ...extraEnv };
  }
  const filtered: NodeJS.ProcessEnv = {};
  for (const key of MINIMAL_ENV_KEYS) {
    if (baseEnv[key] !== undefined) filtered[key] = baseEnv[key];
  }
  for (const key of allowEnv) {
    if (baseEnv[key] !== undefined) filtered[key] = baseEnv[key];
  }
  return { ...filtered, ...extraEnv };
}

function escapeSbplString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function resolveExistingRealpath(target: string): string {
  return existsSync(target) ? realpathSync(target) : target;
}

/** 生成 macOS Seatbelt（SBPL）沙箱策略：默认放行基础系统读取，全局禁止文件写入并按白名单放行。 */
export function buildDarwinSeatbeltProfile(options: {
  rootDir: string;
  readOnly: boolean;
  allowNetwork: boolean;
  allowWritePaths: readonly string[];
}): string {
  const rules: string[] = [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    '(allow file-write* (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty"))',
  ];

  const writablePaths: string[] = [];
  if (!options.readOnly) {
    writablePaths.push(resolveExistingRealpath(options.rootDir));
  }
  for (const extra of options.allowWritePaths) {
    writablePaths.push(resolveExistingRealpath(extra));
  }

  for (const subpath of writablePaths) {
    rules.push(`(allow file-write* (subpath "${escapeSbplString(subpath)}"))`);
  }

  if (!options.allowNetwork) {
    rules.push('(deny network*)');
  }

  return rules.join('\n');
}

export interface ShellExecCommand {
  file: string;
  args: string[];
}

/**
 * 解析最终执行的进程与参数。
 * 显式启用 `'os'` 沙箱但当前平台不支持时直接拒绝，不静默降级。
 */
export function resolveSandboxedExec(
  command: string,
  rootDir: string,
  sandbox: ShellSandboxOptions,
  platform: NodeJS.Platform = process.platform,
): ShellExecCommand | null {
  const mode = sandbox.mode ?? 'none';
  if (mode === 'none') return null;

  if (platform !== 'darwin') {
    throw new OperationRejected(
      `OS-level shell sandbox is not supported on platform "${platform}".`,
      'PERMISSION_DENIED',
    );
  }

  const sandboxExecPath = '/usr/bin/sandbox-exec';
  if (!existsSync(sandboxExecPath)) {
    throw new OperationRejected(
      'macOS sandbox-exec binary (/usr/bin/sandbox-exec) is unavailable.',
      'PERMISSION_DENIED',
    );
  }

  const profile = buildDarwinSeatbeltProfile({
    rootDir,
    readOnly: sandbox.readOnly === true,
    allowNetwork: sandbox.allowNetwork === true,
    allowWritePaths: sandbox.allowWritePaths ?? [],
  });

  return {
    file: sandboxExecPath,
    args: ['-p', profile, '/bin/sh', '-c', command],
  };
}
