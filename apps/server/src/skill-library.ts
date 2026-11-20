/** 宿主技能文件管理：只新增数据目录中的包，不改变运行中 Camp 或执行技能。 */
import { mkdir, realpath, rmdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { ArcherError, SKILL_CONTENT_MAX_BYTES } from '@archer/contracts';
import { discoverSkills, parseSkillFile, type SkillsRoot } from '@archer/skills';

export function createSkillLibrary(roots: readonly SkillsRoot[]) {
  const destination = roots.find(root => root.source === 'archer');
  if (!destination || !isAbsolute(destination.directory)) {
    throw new ArcherError('INVALID_ARGUMENT', '技能管理需要显式的 Archer 数据目录。');
  }
  let tail: Promise<unknown> = Promise.resolve();
  return {
    async add(content: string) {
      // 同一宿主串行校验和创建；目标目录以排他 mkdir 防止覆盖已有包。
      const operation = tail.then(async () => {
        if (Buffer.byteLength(content, 'utf8') > SKILL_CONTENT_MAX_BYTES) {
          throw new ArcherError('INVALID_ARGUMENT', 'SKILL.md 不能超过 64 KiB。');
        }
        const parsed = parseSkillFile(content, 'SKILL.md');
        if (parsed.name === 'read-resource') {
          throw new ArcherError('INVALID_ARGUMENT', 'read-resource 是保留的能力名称。');
        }
        const existing = roots.flatMap(root => discoverSkills(root.directory));
        if (existing.some(item => item.id === parsed.name || item.name === parsed.name)) {
          throw new ArcherError('CONFLICT', '同名技能已存在，请更换名称；不会覆盖已有技能。');
        }
        await mkdir(destination.directory, { recursive: true });
        const root = await realpath(destination.directory);
        const directory = join(root, parsed.name);
        try { await mkdir(directory); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new ArcherError('CONFLICT', '技能目录已存在，不会覆盖。');
          }
          throw error;
        }
        try { await writeFile(join(directory, 'SKILL.md'), content, { flag: 'wx', mode: 0o600 }); }
        catch (error) {
          // 只清理本次新建且仍为空的目录，不递归删除可能由外部添加的内容。
          await rmdir(directory).catch(() => undefined);
          throw error;
        }
        return { name: parsed.name, path: directory, activation: 'restart-required' as const };
      });
      tail = operation.catch(() => undefined);
      return operation;
    },
  };
}
export type SkillLibrary = ReturnType<typeof createSkillLibrary>;
