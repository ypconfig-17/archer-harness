/**
 * Archer Harness — read 工具
 *
 * 通过工作环境读取文本后生成带行号的分页窗口；读取与解码边界由目标 provider 定义。
 */

import {
  toolTargetRevision,
  TOOL_READ_DEFAULT_LIMIT,
  TOOL_READ_SUMMARY,
  TOOL_READ_DOCS,
  TOOL_READ_MAX_BYTES,
  TOOL_READ_MAX_LIMIT,
  TOOL_READ_MAX_LINE_LENGTH,
  TOOL_READ_SCHEMA,
} from './prompt.js';
import { readInteger, readString } from './input.js';
import { toolPath, unwrap } from './paths.js';
import { buildReadWindow, renderReadWindow } from './read-window.js';
import { type ToolContext, type ToolSpec, type ToolOutput } from './types.js';

export const readTool: ToolSpec = {
  name: 'read',
  summary: TOOL_READ_SUMMARY,
  schema: TOOL_READ_SCHEMA,
  docs: TOOL_READ_DOCS,
  mutating: false,
  async execute(context: ToolContext, payload: unknown): Promise<ToolOutput> {
    const inputPath = readString(payload, 'path');
    const offset = readInteger(payload, 'offset', 1) ?? 1;
    const limit =
      readInteger(payload, 'limit', 1, TOOL_READ_MAX_LIMIT) ?? TOOL_READ_DEFAULT_LIMIT;
    const target = toolPath(inputPath);
    const result = unwrap(await context.files.inspect(target));
    async function* chunks(): AsyncGenerator<string> { yield result.content; }
    const window = await buildReadWindow(
      chunks(),
      {
        offset,
        limit,
        maxLineLength: TOOL_READ_MAX_LINE_LENGTH,
        maxBytes: TOOL_READ_MAX_BYTES,
      },
      inputPath,
    );
    return { output: `${renderReadWindow(offset, window)}\n\n${toolTargetRevision(target, result.revision)}`, metadata: { read: { path: target, revision: result.revision, startLine: offset, endLine: window.lines.at(-1)?.number ?? offset, totalLines: window.totalLines, truncated: window.truncatedByBytes } } };
  },
};
