/** 本地技能包 Provider：技能声明来自宿主声明的目录，正文与资源在按需加载时读取。 */
import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { Contribution, JsonValue, Provider, SchemaDescriptor, Skill, SkillContent, SkillMetadata, Tool, ToolMetadata } from '@archer/contracts';
import { ArcherError, OperationRejected, SKILL_CONTENT_MAX_BYTES, validateInput } from '@archer/contracts';
import { provider, skill, tool } from '@archer/camp';
import { contentRevision } from './hash.js';
import { parseSkillFile, discoverSkills } from './manifest.js';
import type { SkillManifest } from './manifest.js';
import { readSkillResource } from './resources.js';
import { READ_RESOURCE_DESCRIPTION, READ_RESOURCE_PATH_DESCRIPTION, READ_RESOURCE_SUMMARY } from './prompt.js';

/** 资源读取工具与技能共用 Provider 能力命名空间，因此保留这个能力 ID。 */
export const SKILL_READ_CAPABILITY_ID = 'read-resource';

export interface SkillsRoot {
  /** 来源标识，例如 standard 或 archer；进入技能声明供界面分组。 */
  readonly source: string;
  /** 必须是绝对目录；Provider 不扫描工作区，也不推断默认路径。 */
  readonly directory: string;
}
export interface SkillsProviderOptions {
  readonly roots: readonly SkillsRoot[];
  readonly id?: string;
}
interface DiscoveredSkill extends SkillManifest {
  readonly source: string;
}

/** CLI 与 Server 的个人技能来源：标准目录供生态复用，数据目录由 Archer 管理。 */
export function defaultSkillsRoots(dataDirectory: string): SkillsRoot[] {
  return [
    { source: 'standard', directory: join(homedir(), '.agents', 'skills') },
    { source: 'archer', directory: join(resolve(dataDirectory), 'skills') },
  ];
}

function normalizeRoots(roots: readonly SkillsRoot[]): SkillsRoot[] {
  if (!Array.isArray(roots) || !roots.length) throw new ArcherError('INVALID_ARGUMENT', 'Skills requires at least one absolute root directory.');
  const seen = new Set<string>();
  return roots.map(root => {
    if (!root || typeof root.source !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]*$/.test(root.source)
      || typeof root.directory !== 'string' || !isAbsolute(root.directory)) {
      throw new ArcherError('INVALID_ARGUMENT', 'Skills roots require a source label and an absolute directory.');
    }
    const directory = resolve(root.directory);
    if (seen.has(directory)) throw new ArcherError('INVALID_ARGUMENT', `Skills root ${directory} is declared more than once.`);
    seen.add(directory);
    return { source: root.source, directory };
  });
}

/** 跨来源重名明确失败，不按扫描顺序覆盖；同一来源内的重名由 discoverSkills 拒绝。 */
function discover(roots: readonly SkillsRoot[]): DiscoveredSkill[] {
  const ids = new Map<string, string>();
  const names = new Map<string, string>();
  const skills: DiscoveredSkill[] = [];
  for (const root of roots) {
    for (const manifest of discoverSkills(root.directory)) {
      if (manifest.id === SKILL_READ_CAPABILITY_ID) {
        throw new ArcherError('INVALID_ARGUMENT', `Skill ${manifest.directory} uses the reserved capability id ${SKILL_READ_CAPABILITY_ID}.`);
      }
      const sameId = ids.get(manifest.id);
      if (sameId !== undefined) {
        throw new ArcherError('INVALID_ARGUMENT', `Skill capability id ${manifest.id} is provided by both ${sameId} and ${manifest.directory}.`);
      }
      const sameName = names.get(manifest.name);
      if (sameName !== undefined) {
        throw new ArcherError('INVALID_ARGUMENT', `Skill name ${manifest.name} is provided by both ${sameName} and ${manifest.directory}.`);
      }
      ids.set(manifest.id, manifest.directory);
      names.set(manifest.name, manifest.directory);
      skills.push({ ...manifest, source: root.source });
    }
  }
  return skills;
}

function inputOf(schema: SchemaDescriptor, input: JsonValue): Record<string, unknown> {
  try { validateInput(schema, input); }
  catch { throw new OperationRejected('Skill resource input does not match the capability schema.', 'INVALID_ARGUMENT'); }
  return input as Record<string, unknown>;
}

/**
 * 每个实例的声明固定；通过创建定义接入时，Camp.refreshProvider 可重新发现并发布能力集合。
 * 正文与资源每次都从磁盘重读，并用内容 SHA-256 作为 revision，避免把旧内容当作当前事实。
 */
export function skillsProvider(options: SkillsProviderOptions): Provider {
  const roots = normalizeRoots(options.roots);
  const discovered = discover(roots);
  const byId = new Map(discovered.map(item => [item.id, item]));
  const capabilities: Record<
    string,
    Contribution<Skill, SkillMetadata> | Contribution<Tool, ToolMetadata>
  > = {};

  // 每个技能独立声明，正文只在调用对应能力时读取。
  for (const item of discovered) {
    capabilities[item.id] = skill({
      name: item.name,
      description: item.description,
      source: item.source,
      path: item.directory,
      ...(item.resources.length ? { resources: item.resources } : {}),
      ...(item.resourcesTruncated ? { resourcesTruncated: true } : {}),
      load: async (context): Promise<SkillContent> => {
        if (context.signal.aborted) {
          throw new OperationRejected('Skill loading was cancelled before reading.', 'ABORTED');
        }
        const bytes = await readFile(item.file, { signal: context.signal });
        if (bytes.byteLength > SKILL_CONTENT_MAX_BYTES) {
          throw new OperationRejected(`Skill ${item.name} exceeds the ${SKILL_CONTENT_MAX_BYTES} byte limit.`, 'INVALID_ARGUMENT');
        }
        const parsed = parseSkillFile(bytes.toString('utf8'), item.file);
        return { content: parsed.body, revision: contentRevision(bytes) };
      },
    });
  }

  // 读取参考资源是同一 Provider 提供的独立工具能力。
  if (discovered.length) {
    const schema: SchemaDescriptor = {
      type: 'object',
      properties: {
        skill: { type: 'string', enum: discovered.map(item => item.id) },
        path: { type: 'string', description: READ_RESOURCE_PATH_DESCRIPTION },
      },
      required: ['skill', 'path'],
      additionalProperties: false,
    };
    capabilities[SKILL_READ_CAPABILITY_ID] = tool({
      description: READ_RESOURCE_DESCRIPTION,
      summary: READ_RESOURCE_SUMMARY,
      inputSchema: schema,
      execution: 'read',
      resultView: 'output',
      invoke: async (input, context) => {
        const value = inputOf(schema, input);
        const item = byId.get(value.skill as string);
        if (!item) {
          throw new OperationRejected(`Skill ${String(value.skill)} is not available.`, 'INVALID_ARGUMENT');
        }

        const resource = await readSkillResource(
          item.directory,
          value.path as string,
          context.signal,
        );
        return {
          output: resource.content,
          skill: item.id,
          path: resource.path,
          revision: resource.revision,
        };
      },
    });
  }
  return provider(options.id ?? 'skills', capabilities, {
    identity: {
      roots: roots.map(root => ({ source: root.source, directory: root.directory })),
      format: 1,
      description: '本地 SKILL.md 技能包，正文与参考文件按需加载。',
    },
  });
}
// 宿主管理入口与 Provider 共用同一格式校验，避免保存后产生无法启动的技能包。
export { parseSkillFile, discoverSkills } from './manifest.js';
