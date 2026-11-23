/** 技能详情的展示规则：来源标签、资源校验与分组；不推断权限，也不补造文件。 */
import type { JsonObject, SkillResource } from '@archer/contracts';

const SOURCE_LABELS: Record<string, string> = { standard: '个人技能', archer: 'Archer 数据目录' };
const RESOURCE_GROUPS = ['references', 'scripts', 'assets'] as const;
const READABLE_GROUPS = new Set<string>(['references', 'scripts']);

export function sourceLabel(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '未声明';
  return SOURCE_LABELS[value] ?? value;
}

export function skillPath(metadata: JsonObject): string | undefined {
  const value = metadata.path;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function skillResources(metadata: JsonObject): SkillResource[] {
  if (!Array.isArray(metadata.resources)) return [];
  return metadata.resources.filter((item): item is SkillResource => item !== null && typeof item === 'object' && !Array.isArray(item)
    && typeof item.path === 'string' && typeof item.size === 'number');
}

export function groupResources(resources: readonly SkillResource[]) {
  return RESOURCE_GROUPS
    .map(group => ({ group, items: resources.filter(item => item.path.startsWith(`${group}/`)) }))
    .filter(item => item.items.length);
}

export function readableResource(path: string): boolean {
  return READABLE_GROUPS.has(path.split('/')[0] ?? '');
}

export function resourcesTruncated(metadata: JsonObject): boolean {
  return metadata.resourcesTruncated === true;
}

export function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
}
