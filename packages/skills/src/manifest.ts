/** SKILL.md 前置元数据解析：只支持 Agent Skills 规范所需的 YAML 子集，不引入额外依赖。 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ArcherError, SKILL_CONTENT_MAX_BYTES } from '@archer/contracts';
import type { SkillResource } from '@archer/contracts';
import { listSkillResources } from './resources.js';

const SKILL_FILE_NAME = 'SKILL.md';
/** 技能名遵循 Agent Skills 规范：小写字母开头，只含小写字母、数字和连字符。 */
const SKILL_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** 能力 ID 由目录名表达；规则与 Camp 的 Provider 能力标识保持一致。 */
const CAPABILITY_ID = /^[A-Za-z][A-Za-z0-9._-]*$/;
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

export interface SkillManifest {
  /** 目录名，同时作为 Camp 中的本地能力 ID。 */
  readonly id: string;
  /** 技能目录的绝对路径；正文与资源都从这里读取。 */
  readonly directory: string;
  /** SKILL.md 的绝对路径；每次 load 都从这里读取最新正文。 */
  readonly file: string;
  readonly name: string;
  readonly description: string;
  readonly body: string;
  readonly resources: readonly SkillResource[];
  readonly resourcesTruncated: boolean;
}

function invalid(file: string, reason: string): never {
  throw new ArcherError('INVALID_ARGUMENT', `Skill package ${file} ${reason}.`);
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value) as string; } catch { return value.slice(1, -1); }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  // 未加引号时，YAML 注释必须以空白开头；正文里的 # 不受影响。
  const comment = value.indexOf(' #');
  return (comment < 0 ? value : value.slice(0, comment)).trim();
}

/**
 * 解析 frontmatter 子集：单行 key: value、引号字符串，以及 > / | 的缩进块。
 * 未知字段保留但不读取，避免把规范中的扩展字段当成错误。
 */
function parseFrontmatter(text: string, file: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    // 已声明字段的缩进块在下方消费；其余缩进内容与顶层列表属于未知字段，保留但不解释。
    if (line.startsWith(' ') || line.startsWith('\t') || line.startsWith('- ')) continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(.*)$/.exec(line);
    if (!match) invalid(file, `contains an unsupported frontmatter line: ${line}`);
    const key = match![1]!;
    const rest = match![2]!.trim();
    if (key in fields) invalid(file, `declares duplicate frontmatter field ${key}`);
    if (rest === '>' || rest === '|' || rest === '>-' || rest === '|-') {
      const block: string[] = [];
      while (index + 1 < lines.length && (lines[index + 1]!.startsWith(' ') || lines[index + 1]!.trim() === '')) {
        block.push(lines[++index]!.trim());
      }
      fields[key] = rest.startsWith('>') ? block.join(' ').trim() : block.join('\n').trim();
    } else {
      // name/description 支持 YAML plain scalar 的缩进续行；遇到嵌套键或顶层字段即结束。
      let value = rest;
      if (value && (key === 'name' || key === 'description')) {
        while (index + 1 < lines.length && lines[index + 1]!.startsWith(' ')
          && !/^\s*[A-Za-z][A-Za-z0-9_-]*:/.test(lines[index + 1]!)) {
          const continuation = lines[++index]!.trim();
          if (continuation) value = `${value} ${continuation}`;
        }
      }
      fields[key] = unquote(value);
    }
  }
  return fields;
}

/** 解析完整 SKILL.md；前置元数据与正文一起校验，非法包在启动时明确失败。 */
export function parseSkillFile(text: string, file: string): { name: string; description: string; body: string } {
  const normalized = text.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  const lines = normalized.split('\n');
  if (lines[0] !== '---') invalid(file, 'must start with a --- frontmatter block');
  const close = lines.indexOf('---', 1);
  if (close < 0) invalid(file, 'has an unclosed frontmatter block');
  const fields = parseFrontmatter(lines.slice(1, close).join('\n'), file);
  const name = fields.name ?? '';
  const description = fields.description ?? '';
  const body = lines.slice(close + 1).join('\n').trim();
  if (!SKILL_NAME.test(name) || name.length > MAX_NAME_LENGTH) {
    invalid(file, `requires a lowercase hyphenated name of at most ${MAX_NAME_LENGTH} characters`);
  }
  if (!description.trim() || description.length > MAX_DESCRIPTION_LENGTH) {
    invalid(file, `requires a non-empty description of at most ${MAX_DESCRIPTION_LENGTH} characters`);
  }
  if (!body) invalid(file, 'requires guidance text after the frontmatter block');
  return { name, description, body };
}

/**
 * 只读取目录的第一层：每个子目录至多贡献一个技能。
 * 缺少 skills 目录表示当前没有技能；单个包非法则整体拒绝，不静默跳过。
 */
export function discoverSkills(rootDirectory: string): SkillManifest[] {
  const directory = resolve(rootDirectory);
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const manifests: SkillManifest[] = [];
  const names = new Map<string, string>();
  for (const entry of entries.filter(item => item.isDirectory()).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const skillDirectory = join(directory, entry.name);
    const file = join(skillDirectory, SKILL_FILE_NAME);
    // 先按磁盘大小拒绝，避免为了校验而把超大文件读入内存。
    let size: number;
    try { size = statSync(file).size; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (size > SKILL_CONTENT_MAX_BYTES) invalid(file, `exceeds the ${SKILL_CONTENT_MAX_BYTES} byte limit`);
    const bytes = readFileSync(file);
    if (!CAPABILITY_ID.test(entry.name)) invalid(file, 'requires a directory name usable as a capability ID');
    const parsed = parseSkillFile(bytes.toString('utf8'), file);
    const previous = names.get(parsed.name);
    if (previous !== undefined) invalid(file, `reuses the skill name ${parsed.name} from ${previous}`);
    names.set(parsed.name, file);
    const listing = listSkillResources(skillDirectory);
    manifests.push({
      id: entry.name, directory: skillDirectory, file, ...parsed,
      resources: listing.resources, resourcesTruncated: listing.truncated,
    });
  }
  return manifests;
}