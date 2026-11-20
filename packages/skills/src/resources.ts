/** 技能包资源：只读清单、路径约束与受限读取；脚本只允许查看，不在这里执行。 */
import { readdirSync, statSync } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { OperationRejected } from '@archer/contracts';
import type { SkillResource } from '@archer/contracts';
import { contentRevision } from './hash.js';

export const SKILL_RESOURCE_ROOTS = ['references', 'scripts', 'assets'] as const;
/** 只有参考文档和脚本正文可读；assets 用于展示或复制，不当作文本加载。 */
export const SKILL_READABLE_ROOTS = ['references', 'scripts'] as const;
export const SKILL_RESOURCE_LIST_LIMIT = 100;
export const SKILL_RESOURCE_MAX_BYTES = 32_768;

export interface SkillResourceListing {
  readonly resources: readonly SkillResource[];
  readonly truncated: boolean;
}

function ignored(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** 清单只收录普通文件；符号链接不进入声明，避免展示未声明的跳转目标。 */
export function listSkillResources(directory: string): SkillResourceListing {
  const resources: SkillResource[] = [];
  let truncated = false;
  const visit = (absolute: string, relative: string): void => {
    let entries;
    try { entries = readdirSync(absolute, { withFileTypes: true }); }
    catch (error) { if (ignored(error)) return; throw error; }
    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (truncated) return;
      const next = `${relative}/${entry.name}`;
      if (entry.isDirectory()) { visit(join(absolute, entry.name), next); continue; }
      if (!entry.isFile()) continue;
      if (resources.length >= SKILL_RESOURCE_LIST_LIMIT) { truncated = true; return; }
      let size: number;
      try { size = statSync(join(absolute, entry.name)).size; }
      catch (error) { if (ignored(error)) continue; throw error; }
      resources.push({ path: next, size });
    }
  };
  for (const root of SKILL_RESOURCE_ROOTS) visit(join(directory, root), root);
  return { resources, truncated };
}

/** 拒绝绝对路径、反斜杠、空段和上级目录；只接受 references/ 或 scripts/ 下的相对文件。 */
function normalizeResourcePath(value: string): string {
  const segments = value.split('/');
  const invalid = !value || value.includes('\\') || value.includes('\u0000')
    || segments.some(segment => !segment || segment === '.' || segment === '..')
    || !SKILL_READABLE_ROOTS.includes(segments[0] as typeof SKILL_READABLE_ROOTS[number])
    || segments.length < 2;
  if (invalid) throw new OperationRejected('Skill resources must be relative paths under references/ or scripts/.', 'INVALID_ARGUMENT');
  return segments.join('/');
}

export interface SkillResourceContent {
  readonly path: string;
  readonly content: string;
  readonly revision: string;
}

/**
 * 读取前用 realpath 固定真实目标并校验仍在技能目录内，符号链接不能逃逸来源边界。
 * 上限按磁盘上的完整文件大小判断，不先读入内存。
 */
export async function readSkillResource(directory: string, path: string, signal: AbortSignal): Promise<SkillResourceContent> {
  if (signal.aborted) throw new OperationRejected('Skill resource reading was cancelled before access.', 'ABORTED');
  const normalized = normalizeResourcePath(path);
  const root = await realpath(directory);
  let target: string;
  try { target = await realpath(join(directory, ...normalized.split('/'))); }
  catch (error) {
    if (ignored(error)) throw new OperationRejected(`Skill resource ${normalized} does not exist.`, 'INVALID_ARGUMENT');
    throw error;
  }
  if (!target.startsWith(`${root}/`)) {
    throw new OperationRejected('Skill resource resolves outside its package.', 'PERMISSION_DENIED');
  }
  const info = await stat(target);
  if (!info.isFile()) throw new OperationRejected('Skill resources must be regular files.', 'INVALID_ARGUMENT');
  if (info.size > SKILL_RESOURCE_MAX_BYTES) {
    throw new OperationRejected(`Skill resource ${normalized} exceeds the ${SKILL_RESOURCE_MAX_BYTES} byte limit.`, 'INVALID_ARGUMENT');
  }
  const bytes = await readFile(target, { signal });
  const content = bytes.toString('utf8');
  if (content.includes('\u0000')) throw new OperationRejected('Skill resources must be UTF-8 text.', 'INVALID_ARGUMENT');
  return { path: normalized, content, revision: contentRevision(bytes) };
}