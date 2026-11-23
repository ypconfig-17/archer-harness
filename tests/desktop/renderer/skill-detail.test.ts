/** 技能详情只展示声明中的来源与资源；资源是否可读不改变来源声明的含义。 */
import { expect, it } from 'vitest';
import {
  formatSize, groupResources, readableResource, resourcesTruncated, skillPath, skillResources, sourceLabel,
} from '../../../apps/desktop/renderer/src/lib/skill-detail';

it('来源与路径只采用已声明值，缺失时明确未声明', () => {
  expect(sourceLabel('standard')).toBe('个人技能');
  expect(sourceLabel('archer')).toBe('Archer 数据目录');
  expect(sourceLabel('custom-root')).toBe('custom-root');
  expect(sourceLabel(undefined)).toBe('未声明');
  expect(skillPath({ path: '/skills/review' })).toBe('/skills/review');
  expect(skillPath({})).toBeUndefined();
});

it('资源清单过滤非法条目并按目录分组，assets 只列出不预览', () => {
  const resources = [
    { path: 'scripts/check.sh', size: 12 },
    { path: 'references/a.md', size: 2048 },
    { path: 'assets/logo.png', size: 4096 },
    { path: 'other/x.md', size: 1 },
    { path: 'references/broken.md' },
  ];
  expect(skillResources({ resources })).toHaveLength(4);
  expect(groupResources(skillResources({ resources })).map(item => [item.group, item.items.map(entry => entry.path)])).toEqual([
    ['references', ['references/a.md']],
    ['scripts', ['scripts/check.sh']],
    ['assets', ['assets/logo.png']],
  ]);
  expect(skillResources({ resources: 'not-an-array' })).toEqual([]);
  expect(groupResources([])).toEqual([]);
  expect(readableResource('references/a.md')).toBe(true);
  expect(readableResource('scripts/check.sh')).toBe(true);
  expect(readableResource('assets/logo.png')).toBe(false);
  expect(resourcesTruncated({ resourcesTruncated: true })).toBe(true);
  expect(resourcesTruncated({ resourcesTruncated: 'yes' })).toBe(false);
  expect(formatSize(512)).toBe('512 B');
  expect(formatSize(2048)).toBe('2.0 KB');
  expect(formatSize(20 * 1024)).toBe('20 KB');
});

