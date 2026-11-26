/** Shell 沙箱与环境变量隔离：白名单过滤、非支持平台显式拒绝、macOS Seatbelt 写入边界验证。 */
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OperationRejected } from '@archer/contracts';
import { createCamp, TOOL } from '@archer/camp';
import {
  ShellProvider,
  buildShellEnv,
  resolveSandboxedExec,
  shellProvider,
} from '@archer/providers';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('Shell 环境变量隔离与平台守卫', () => {
  it('minimal 模式剥离敏感宿主变量，只透传基础白名单与显式 allowEnv', () => {
    const baseEnv: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOME: '/Users/tester',
      OPENAI_API_KEY: 'sk-secret',
      CUSTOM_ALLOWED: 'yes',
    };
    const result = buildShellEnv(baseEnv, { EXTRA: '1' }, 'minimal', ['CUSTOM_ALLOWED']);
    expect(result.PATH).toBe('/usr/bin');
    expect(result.HOME).toBe('/Users/tester');
    expect(result.OPENAI_API_KEY).toBeUndefined();
    expect(result.CUSTOM_ALLOWED).toBe('yes');
    expect(result.EXTRA).toBe('1');
  });

  it('显式开启 os 沙箱但在不支持的平台运行时直接拒绝，不静默降级', () => {
    expect(() => resolveSandboxedExec('echo ok', '/tmp', { mode: 'os' }, 'win32')).toThrowError(
      OperationRejected,
    );
    expect(() => resolveSandboxedExec('echo ok', '/tmp', { mode: 'os' }, 'linux')).toThrowError(
      'not supported on platform',
    );
  });

  it('修改沙箱配置会改变 shellProvider 的 CapabilityRef.revision', async () => {
    const campPlain = await createCamp({ providers: [shellProvider()] });
    const campSandboxed = await createCamp({
      providers: [shellProvider({ sandbox: { mode: 'os' } })],
    });
    try {
      const plainRef = campPlain.list(TOOL)[0]!.ref;
      const sandboxedRef = campSandboxed.list(TOOL)[0]!.ref;
      expect(plainRef.revision).not.toBe(sandboxedRef.revision);
    } finally {
      await campPlain.close();
      await campSandboxed.close();
    }
  });
});

describe.skipIf(process.platform !== 'darwin')('macOS sandbox-exec 真实隔离边界', () => {
  it('允许工作区内写入，并从 OS 内核层面阻止工作区外写入及敏感环境变量泄露', async () => {
    const workspace = makeTempDir('archer-sb-ws-');
    const outside = makeTempDir('archer-sb-out-');
    const outsideFile = path.join(outside, 'escape.txt');

    const prevSecret = process.env.ARCHER_TEST_SECRET_KEY;
    process.env.ARCHER_TEST_SECRET_KEY = 'top-secret-token';
    try {
      const shell = new ShellProvider(workspace, { sandbox: { mode: 'os' } });
      const signal = new AbortController().signal;

      // 1. 工作区内写入允许
      const insideRes = (await shell.execute('echo inside > ok.txt', signal)) as {
        isError: boolean;
      };
      expect(insideRes.isError).toBe(false);
      expect(existsSync(path.join(workspace, 'ok.txt'))).toBe(true);

      // 2. 工作区外写入被 macOS Seatbelt 拒绝
      const escapeRes = (await shell.execute(`touch "${outsideFile}"`, signal)) as {
        isError: boolean;
      };
      expect(escapeRes.isError).toBe(true);
      expect(existsSync(outsideFile)).toBe(false);

      // 3. minimal 环境变量策略下读不到宿主敏感变量
      const envRes = (await shell.execute('echo "VAL=$ARCHER_TEST_SECRET_KEY"', signal)) as {
        output: string;
      };
      expect(envRes.output).toContain('VAL=');
      expect(envRes.output).not.toContain('top-secret-token');
    } finally {
      if (prevSecret === undefined) delete process.env.ARCHER_TEST_SECRET_KEY;
      else process.env.ARCHER_TEST_SECRET_KEY = prevSecret;
    }
  });

  it('只读模式（readOnly: true）下连工作区内写入也会被 OS 沙箱拦截', async () => {
    const workspace = makeTempDir('archer-sb-ro-');
    const shell = new ShellProvider(workspace, { sandbox: { mode: 'os', readOnly: true } });
    const res = (await shell.execute('touch denied.txt', new AbortController().signal)) as {
      isError: boolean;
    };
    expect(res.isError).toBe(true);
    expect(existsSync(path.join(workspace, 'denied.txt'))).toBe(false);
  });
});
