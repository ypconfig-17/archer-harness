/**
 * Archer Harness — glob 工具
 *
 * 通过工作环境目录端口遍历文件，跳过固定忽略目录；输出业务文件路径。
 */

import {
  TOOL_GLOB_DEFAULT_MAX_RESULTS,
  TOOL_GLOB_SUMMARY,
  TOOL_GLOB_DOCS,
  TOOL_GLOB_MAX_RESULTS_LIMIT,
  TOOL_GLOB_NO_MATCHES,
  TOOL_GLOB_SCHEMA,
  toolGlobTruncated,
} from './prompt.js';
import { readInteger, readString } from './input.js';
import { matchesGlob, normalizeGlobPattern } from './glob-pattern.js';
import { toolPath } from './paths.js';
import { toolCancelled, type ToolContext, type ToolSpec, type ToolOutput } from './types.js';
import { walkFiles } from './walk.js';

export const globTool: ToolSpec = {
  name: 'glob',
  summary: TOOL_GLOB_SUMMARY,
  schema: TOOL_GLOB_SCHEMA,
  docs: TOOL_GLOB_DOCS,
  mutating: false,
  async execute(context: ToolContext, payload: unknown): Promise<ToolOutput> {
    const pattern = readString(payload, 'pattern');
    const inputPath = readString(payload, 'path');
    const maxResults =
      readInteger(payload, 'maxResults', 1, TOOL_GLOB_MAX_RESULTS_LIMIT)
      ?? TOOL_GLOB_DEFAULT_MAX_RESULTS;
    const normalizedPattern = normalizeGlobPattern(pattern);
    const target = toolPath(inputPath);
    const matches: string[] = [];
    let truncated = false;
    await walkFiles(target, context, (file) => {
      if (!matchesGlob(file.relativePath, normalizedPattern)) return true;
      if (matches.length >= maxResults) { truncated = true; return false; }
      matches.push(file.path);
      return true;
    });
    if (context.signal.aborted) throw toolCancelled();

    const paths = matches;
    if (paths.length === 0) return { output: TOOL_GLOB_NO_MATCHES, metadata: { search: { count: 0, truncated: false } } };

    return { metadata: { search: { count: paths.length, truncated } }, output: truncated
      ? `${paths.join('\n')}\n\n${toolGlobTruncated(maxResults)}`
      : paths.join('\n') };
  },
};
