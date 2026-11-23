/**
 * Archer Harness — write 工具
 *
 * 整体写入工作环境文件，不隐式创建父目录。写入开始后的异常
 * 不再转换为确定性失败，由 provider 上抛并记录为未知副作用。
 */

import {
  toolTargetRevision,
  TOOL_WRITE_SUMMARY,
  TOOL_WRITE_DOCS,
  TOOL_WRITE_SCHEMA,
  toolWriteOutput,
} from './prompt.js';
import { readString, readText, readExpectedRevision } from './input.js';
import { toolPath, unwrap } from './paths.js';
import { ToolInputError, toolCancelled, type ToolContext, type ToolSpec, type ToolOutput } from './types.js';

export const writeTool: ToolSpec = {
  name: 'write',
  summary: TOOL_WRITE_SUMMARY,
  schema: TOOL_WRITE_SCHEMA,
  docs: TOOL_WRITE_DOCS,
  mutating: true,
  async execute(context: ToolContext, payload: unknown): Promise<ToolOutput> {
    const inputPath = readString(payload, 'path');
    const content = readText(payload, 'content');
    if (context.signal.aborted) throw toolCancelled();

    const result = unwrap(await context.files.write(toolPath(inputPath), content, readExpectedRevision(payload)));
    if (!result.ok) throw new ToolInputError(result.error.message, result.error.code);
    return {
      output: `${toolWriteOutput(inputPath, Buffer.byteLength(content, 'utf8'))}\n${toolTargetRevision(inputPath, result.revisionAfter)}`,
      metadata: { fileChange: { revisionBefore: result.revisionBefore, revisionAfter: result.revisionAfter, path: toolPath(inputPath), after: content, ...(result.revisionBefore === null ? { before: null }
        : typeof result.metadata?.before === 'string' ? { before: result.metadata.before } : {}) } },
    };
  },
};
