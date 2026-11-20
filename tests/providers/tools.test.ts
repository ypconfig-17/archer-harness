/**
 * 工具目录测试：目录发现、读写编辑、搜索、路径边界与 Shell 开关。
 */

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateInput, type FileAccess } from '@archer/contracts';
import { TOOL } from '@archer/camp';
import { toolsProvider, workspaceFiles } from '@archer/providers';

interface Workspace {
  parent: string;
  root: string;
}

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<Workspace> {
  const parent = await mkdtemp(join(tmpdir(), 'archer-file-tools-'));
  tempDirs.push(parent);
  const root = join(parent, 'workspace');
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(join(root, 'README.md'), '# 示例\n\n第二行\n', 'utf-8');
  await writeFile(join(root, 'src', 'index.ts'), 'export const x = 1;\n', 'utf-8');
  await writeFile(join(root, 'src', 'util.ts'), 'export function add(a: number, b: number) {\n  return a + b;\n}\n', 'utf-8');
  await writeFile(join(root, 'node_modules', 'pkg', 'index.ts'), 'export const hidden = true;\n', 'utf-8');
  await writeFile(join(root, 'crlf.txt'), 'const a = 1;\r\nconst b = 2;\r\n', 'utf-8');
  await writeFile(join(root, 'blob.bin'), Buffer.from([0x61, 0x00, 0x62]));
  await writeFile(join(parent, 'outside.txt'), 'outside\n', 'utf-8');
  await symlink(join(parent, 'outside.txt'), join(root, 'link.txt'));
  return { parent, root };
}

interface Environment { files: FileAccess }
function createEnvironment(root: string): Environment { return { files: workspaceFiles({ cwd: root, access: 'edit' }, signal) }; }
async function invoke(environment: Environment, id: string, input: unknown) {
  const contribution = toolsProvider().capabilities[id]!;
  const metadata = TOOL.metadata.parse(contribution.metadata);
  validateInput(metadata.inputSchema, input as import('@archer/contracts').JsonValue);
  return contribution.implementation.invoke(input, { signal, files: environment.files });
}

const signal = new AbortController().signal;

async function callTool(
  environment: Environment,
  tool: string,
  payload: unknown,
): Promise<string> {
  const result = await invoke(environment, tool, payload);
  return (result as { output: string }).output;
}

async function failTool(environment: Environment, tool: string, payload: unknown): Promise<{ code: string; message: string }> {
  try { await invoke(environment, tool, payload); }
  catch (error) { return { code: (error as { code?: string }).code ?? 'PROVIDER_ERROR', message: (error as Error).message }; }
  throw new Error('Expected failure.');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('文件工具', () => {
  it('read 支持分页并报告总行数', async () => {
    const { root } = await makeWorkspace();
    const environment = createEnvironment(root);

    const first = await callTool(environment, 'read', { path: 'README.md' });
    expect(first).toContain('1: # 示例\n2: \n3: 第二行\n\n[End of file: 3 lines.]');
    expect(first).toContain('Target revision:');

    const window = await callTool(environment, 'read', {
      path: 'README.md',
      offset: 2,
      limit: 1,
    });
    expect(window).toContain('2: ');
    expect(window).toContain('[Showing lines 2-2 of 3; continue with offset=3.]');
  });

  it('shell 风格载荷被确定性拒绝，不进入路径解析', async () => {
    const { root } = await makeWorkspace();
    const environment = createEnvironment(root);

    const result = await failTool(environment, 'read', { command: 'cat README.md' });
    expect(result.code).toBe('PROVIDER_ERROR');
    expect(result.message).toContain('"path"');
    expect(result.message).not.toContain(root);
  });

  it('read 拒绝越界 offset、二进制文件与 symlink 逃逸', async () => {
    const { root } = await makeWorkspace();
    const environment = createEnvironment(root);

    const outOfRange = await failTool(environment, 'read', { path: 'README.md', offset: 99 });
    expect(outOfRange.message).toContain('beyond the end');

    const binary = await failTool(environment, 'read', { path: 'blob.bin' });
    expect(binary.message).toContain('Binary files');

    const escape = await failTool(environment, 'read', { path: 'link.txt' });
    expect(escape.code).toBe('PROVIDER_ERROR');

    const traversal = await failTool(environment, 'read', { path: '../outside.txt' });
    expect(traversal.code).toBe('PATH_INVALID');
  });

  it('write 复用文件节点边界，父目录必须已存在', async () => {
    const { parent, root } = await makeWorkspace();
    const environment = createEnvironment(root);
    await mkdir(join(root, 'nested', 'dir'), { recursive: true });

    await callTool(environment, 'write', {
      path: 'nested/dir/notes.md',
      content: 'hello\n',
    });
    expect(await readFile(join(root, 'nested', 'dir', 'notes.md'), 'utf-8')).toBe('hello\n');

    const escape = await failTool(environment, 'write', {
      path: '../escape.txt',
      content: 'nope',
    });
    expect(escape.code).toBe('PATH_INVALID');
    await expect(readFile(join(parent, 'escape.txt'), 'utf-8')).rejects.toThrow();

    const symlinkEscape = await failTool(environment, 'write', {
      path: 'link.txt',
      content: 'nope',
    });
    expect(symlinkEscape.code).toBe('PROVIDER_ERROR');
    expect(await readFile(join(parent, 'outside.txt'), 'utf-8')).toBe('outside\n');
  });

  it('edit 保留 CRLF 并要求唯一匹配', async () => {
    const { root } = await makeWorkspace();
    const environment = createEnvironment(root);

    await callTool(environment, 'edit', {
      path: 'crlf.txt',
      old_string: 'const a = 1;',
      new_string: 'const a = 3;',
    });
    expect(await readFile(join(root, 'crlf.txt'), 'utf-8')).toBe(
      'const a = 3;\r\nconst b = 2;\r\n',
    );

    const ambiguous = await failTool(environment, 'edit', {
      path: 'src/util.ts',
      old_string: 'number',
      new_string: 'int',
    });
    expect(ambiguous.message).toContain('matched 2 times');

    const unchanged = await failTool(environment, 'edit', {
      path: 'crlf.txt',
      old_string: 'const a = 3;',
      new_string: 'const a = 3;',
    });
    expect(unchanged.message).toContain('identical');
  });

  it('list 返回 目录直接子项与文件描述', async () => {
    const { root } = await makeWorkspace();
    const environment = createEnvironment(root);

    const output = await callTool(environment, 'list', { path: '.' });
    expect(output).toContain('[dir] src');
    expect(output).toContain('[file] README.md');
    expect(output).not.toContain('link.txt');
  });
});

describe('搜索工具', () => {
  it('glob 只返回文件并跳过忽略目录', async () => {
    const { root } = await makeWorkspace();
    const environment = createEnvironment(root);

    const output = await callTool(environment, 'glob', { pattern: '**/*.ts', path: '.' });
    expect(output.split('\n').sort()).toEqual(['./src/index.ts', './src/util.ts']);

    const byName = await callTool(environment, 'glob', { pattern: '*.txt', path: '.' });
    expect(byName).toContain('crlf.txt');
    expect(byName).not.toContain('link.txt');
  });

  it('grep 返回路径、行号与列号，并跳过二进制文件', async () => {
    const { root } = await makeWorkspace();
    const environment = createEnvironment(root);

    const output = await callTool(environment, 'grep', {
      pattern: 'export const',
      path: '.',
      glob: '**/*.ts',
    });
    expect(output).toContain('src/index.ts:1:1: export const x = 1;');
    expect(output).not.toContain('node_modules');

    const filtered = await callTool(environment, 'grep', {
      pattern: 'CONST',
      ignoreCase: true,
      path: 'src',
    });
    expect(filtered).toContain('src/index.ts:1:8:');
  });

  it('拒绝非法的 glob 与正则', async () => {
    const { root } = await makeWorkspace();
    const environment = createEnvironment(root);

    const badGlob = await failTool(environment, 'glob', { pattern: '../**/*.ts', path: '.' });
    expect(badGlob.code).toBe('PATH_INVALID');

    const badRegex = await failTool(environment, 'grep', { pattern: '(', path: '.' });
    expect(badRegex.message).toContain('Invalid regular expression');
  });
});

describe('节点取消语义', () => {
  it('已取消时拒绝调用，不开始工具执行', async () => {
    const { root } = await makeWorkspace();
    await expect(invoke({ files: workspaceFiles({ cwd: root, access: 'edit' }, AbortSignal.abort()) }, 'read', { path: 'README.md' })).rejects.toThrow('cancelled');
  });
});

it('编辑结果记录实际的原文和写入内容，供历史 diff 使用', async () => {
  const workspace = await makeWorkspace();
  const environment = createEnvironment(workspace.root);
  const result = await invoke(environment, 'edit', { path: 'src/index.ts', old_string: 'x = 1', new_string: 'x = 2' });
  expect(result).toMatchObject({ metadata: { fileChange: { path: 'src/index.ts', before: 'export const x = 1;\n', after: 'export const x = 2;\n' } } });
  await writeFile(join(workspace.root, 'src', 'index.ts'), 'external change');
  expect(result).toMatchObject({ metadata: { fileChange: { after: 'export const x = 2;\n' } } });
});

it('无 Git 的整体写入回执保留原文、连续写入和确认新增', async () => {
  const { root } = await makeWorkspace();
  const environment = createEnvironment(root);
  const first = await invoke(environment, 'write', { path: 'src/index.ts', content: 'second\n' });
  expect(first).toMatchObject({ metadata: { fileChange: { before: 'export const x = 1;\n', after: 'second\n' } } });
  const second = await invoke(environment, 'write', { path: 'src/index.ts', content: 'third\n' });
  expect(second).toMatchObject({ metadata: { fileChange: { before: 'second\n', after: 'third\n' } } });
  const added = await invoke(environment, 'write', { path: 'new.ts', content: 'new\n' });
  expect(added).toMatchObject({ metadata: { fileChange: { before: null, after: 'new\n' } } });
});

it('超限旧文件不把原文省略伪装为空', async () => {
  const { root } = await makeWorkspace();
  await writeFile(join(root, 'large.txt'), 'x'.repeat(256 * 1024 + 1));
  const result = await invoke(createEnvironment(root), 'write', { path: 'large.txt', content: 'small' });
  expect(result).not.toHaveProperty('metadata.fileChange.before');
});
