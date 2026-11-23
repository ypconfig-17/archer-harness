/**
 * Archer Harness — edit 工具
 *
 * 精确字面量替换。匹配前统一 CRLF 与 LF，写回时恢复原文件的换行风格；
 * 默认要求唯一匹配。实现移植自 deepseek-harness 的 fs-local/fsio.ts
 * 与 tools/editFile.ts（MIT，Copyright (c) 2026 DeepSeek）。
 */

import {
  toolTargetRevision,
  TOOL_EDIT_SUMMARY,
  TOOL_EDIT_DOCS,
  TOOL_EDIT_OLD_EMPTY,
  TOOL_EDIT_SCHEMA,
  TOOL_EDIT_UNCHANGED,
  toolEditMultipleMatches,
  toolEditNotFound,
  toolEditOutput,
} from './prompt.js';
import { readBoolean, readString, readText, readExpectedRevision } from './input.js';
import { toolPath, unwrap } from './paths.js';
import { ToolInputError, toolCancelled, type ToolContext, type ToolSpec, type ToolOutput } from './types.js';

type LineEndings = 'LF' | 'CRLF';

export const editTool: ToolSpec = {
  name: 'edit',
  summary: TOOL_EDIT_SUMMARY,
  schema: TOOL_EDIT_SCHEMA,
  docs: TOOL_EDIT_DOCS,
  mutating: true,
  async execute(context: ToolContext, payload: unknown): Promise<ToolOutput> {
    const inputPath = readString(payload, 'path');
    const oldString = readText(payload, 'old_string');
    const newString = readText(payload, 'new_string');
    const replaceAll = readBoolean(payload, 'replace_all') ?? false;
    if (oldString.length === 0) {
      throw new ToolInputError(TOOL_EDIT_OLD_EMPTY);
    }
    if (context.signal.aborted) throw toolCancelled();

    const target = toolPath(inputPath);
    const inspected = unwrap(await context.files.inspect(target));
    const expected = readExpectedRevision(payload);
    if (expected !== undefined && expected !== inspected.revision) {
      throw new ToolInputError('Target revision does not match expectedRevision.', 'REVISION_CONFLICT');
    }
    const raw = inspected.content;
    if (context.signal.aborted) throw toolCancelled();

    const lineEndings = detectLineEndings(raw);
    const content = normalizeLineEndings(raw);
    const edited = applyLiteralEdit(content, oldString, newString, replaceAll, inputPath);
    const next = restoreLineEndings(edited.content, lineEndings);

    const result = unwrap(await context.files.write(target, next, inspected.revision));
    if (!result.ok) throw new ToolInputError(result.error.message, result.error.code);
    return { output: `${toolEditOutput(
      inputPath,
      edited.replacements,
      Buffer.byteLength(next, 'utf8'),
    )}\n${toolTargetRevision(inputPath, result.revisionAfter)}`, metadata: { fileChange: { path: target, before: raw, after: next, revisionBefore: result.revisionBefore, revisionAfter: result.revisionAfter, replacements: edited.replacements } } };
  },
};

function normalizeLineEndings(content: string): string {
  return content.replaceAll('\r\n', '\n');
}

function detectLineEndings(raw: string): LineEndings {
  const sample = raw.slice(0, 4096);
  const crlfCount = sample.split('\r\n').length - 1;
  const lfCount = sample.split('\n').length - 1 - crlfCount;
  return crlfCount > lfCount ? 'CRLF' : 'LF';
}

function restoreLineEndings(content: string, lineEndings: LineEndings): string {
  if (lineEndings === 'LF') return content;
  return normalizeLineEndings(content).split('\n').join('\r\n');
}

function countOccurrences(content: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (true) {
    const found = content.indexOf(needle, index);
    if (found === -1) return count;
    count += 1;
    index = found + needle.length;
  }
}

function applyLiteralEdit(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
  displayPath: string,
): { content: string; replacements: number } {
  const oldNormalized = normalizeLineEndings(oldString);
  const newNormalized = normalizeLineEndings(newString);
  if (oldNormalized === newNormalized) {
    throw new ToolInputError(TOOL_EDIT_UNCHANGED);
  }

  const replacements = countOccurrences(content, oldNormalized);
  if (replacements === 0) {
    throw new ToolInputError(toolEditNotFound(displayPath));
  }
  if (!replaceAll && replacements > 1) {
    throw new ToolInputError(toolEditMultipleMatches(displayPath, replacements));
  }
  return {
    content: content.split(oldNormalized).join(newNormalized),
    replacements,
  };
}
