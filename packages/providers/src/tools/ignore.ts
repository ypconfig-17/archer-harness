/**
 * Archer Harness — 搜索工具的目录忽略规则
 *
 * 与常见构建产物保持一致的固定列表；不读取 .gitignore，避免搜索结果依赖
 * 工作区外的规则文件。符号链接在遍历时一律跳过。
 */

export const SEARCH_IGNORED_DIRS: ReadonlySet<string> = new Set([
  '.git',
  '.svn',
  '.hg',
  '.next',
  '.turbo',
  '.cache',
  '.idea',
  'node_modules',
  'dist',
  'build',
  'coverage',
]);
