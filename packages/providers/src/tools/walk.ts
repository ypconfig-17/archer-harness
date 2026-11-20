/** 在调用方工作环境中遍历普通文件；目录边界由文件端口检查。 */
import { SEARCH_IGNORED_DIRS } from './ignore.js';
import { toolCancelled, ToolInputError, type ToolContext } from './types.js';
import { unwrap } from './paths.js';

export interface WalkedFile { path: string; relativePath: string }

export async function walkFiles(
  root: string,
  context: ToolContext,
  visit: (file: WalkedFile) => boolean | Promise<boolean>,
): Promise<void> {
  let visited = 0;
  async function directory(path: string, relative: string, depth: number): Promise<boolean> {
    if (context.signal.aborted) throw toolCancelled();
    if (depth > 64 || ++visited > 10000) throw new ToolInputError('Search traversal limit reached. Narrow the path.');
    const entries = unwrap(await context.files.list(path));
    for (const entry of entries) {
      if (context.signal.aborted) throw toolCancelled();
      const child = { path: `${path === '/' ? '' : path}/${entry.name}`, relativePath: relative ? `${relative}/${entry.name}` : entry.name };
      if (entry.kind === 'dir' && !SEARCH_IGNORED_DIRS.has(entry.name)) {
        if (!await directory(child.path, child.relativePath, depth + 1)) return false;
      } else if (entry.kind === 'file') {
        if (!await visit(child)) return false;
      }
    }
    return true;
  }
  await directory(root, '', 0);
}
