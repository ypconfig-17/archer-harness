/**
 * Archer Harness — grep 工具
 *
 * 通过工作环境文件端口按 JS 正则搜索，返回 path:line:column。
 * 不可读文件与忽略目录跳过；读取限制由目标 provider 定义。
 */

import {
  TOOL_GREP_DEFAULT_MAX_RESULTS,
  TOOL_GREP_SUMMARY,
  TOOL_GREP_DOCS,
  TOOL_GREP_LINE_TRUNCATED,
  TOOL_GREP_MAX_LINE_CHARS,
  TOOL_GREP_MAX_RESULTS_LIMIT,
  TOOL_GREP_NO_MATCHES,
  TOOL_GREP_SCHEMA,
  toolGrepInvalidPattern,
  toolGrepMatch,
  toolGrepTruncated,
} from './prompt.js';
import { readBoolean, readInteger, readOptionalString, readString } from './input.js';
import { matchesGlob, normalizeGlobPattern } from './glob-pattern.js';
import { toolPath } from './paths.js';
import { ToolInputError, toolCancelled, type ToolContext, type ToolSpec, type ToolOutput } from './types.js';
import { walkFiles } from './walk.js';

interface GrepMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}

export const grepTool: ToolSpec = {
  name: 'grep',
  summary: TOOL_GREP_SUMMARY,
  schema: TOOL_GREP_SCHEMA,
  docs: TOOL_GREP_DOCS,
  mutating: false,
  async execute(context: ToolContext, payload: unknown): Promise<ToolOutput> {
    const pattern = readString(payload, 'pattern');
    const inputPath = readString(payload, 'path');
    const glob = readOptionalString(payload, 'glob');
    const ignoreCase = readBoolean(payload, 'ignoreCase') ?? false;
    const maxResults =
      readInteger(payload, 'maxResults', 1, TOOL_GREP_MAX_RESULTS_LIMIT)
      ?? TOOL_GREP_DEFAULT_MAX_RESULTS;

    let expression: RegExp;
    try {
      expression = new RegExp(pattern, ignoreCase ? 'i' : '');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ToolInputError(
        toolGrepInvalidPattern(message.replace(/^Invalid regular expression:\s*/i, '')),
      );
    }
    const normalizedGlob = glob === undefined ? undefined : normalizeGlobPattern(glob);

    const target = toolPath(inputPath);
    const matches: GrepMatch[] = [];
    let truncated = false;

    await walkFiles(target, context, async (file) => {
      if (normalizedGlob !== undefined && !matchesGlob(file.relativePath, normalizedGlob)) return true;
      const inspected = await context.files.inspect(file.path);
      if (!inspected.ok) return true;
      const content = inspected.value.content;
      const lines = content.split('\n');
      for (let index = 0; index < lines.length; index += 1) {
        if (context.signal.aborted) throw toolCancelled();
        const rawLine = lines[index]!;
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        const match = expression.exec(line);
        if (!match) continue;
        if (matches.length >= maxResults) {
          truncated = true;
          return false;
        }
        matches.push({
          path: file.path,
          line: index + 1,
          column: [...line.slice(0, match.index)].length + 1,
          text: previewLine(line),
        });
      }
      return true;
    });

    matches.sort(
      (a, b) =>
        a.path.localeCompare(b.path)
        || a.line - b.line
        || a.column - b.column,
    );

    if (matches.length === 0) return { output: TOOL_GREP_NO_MATCHES, metadata: { search: { count: 0, truncated: false } } };
    const lines = matches.map((match) =>
      toolGrepMatch(match.path, match.line, match.column, match.text),
    );
    return { metadata: { search: { count: matches.length, truncated } }, output: truncated
      ? `${lines.join('\n')}\n\n${toolGrepTruncated(maxResults)}`
      : lines.join('\n') };
  },
};

function previewLine(text: string): string {
  return text.length > TOOL_GREP_MAX_LINE_CHARS
    ? `${text.slice(0, TOOL_GREP_MAX_LINE_CHARS)}${TOOL_GREP_LINE_TRUNCATED}`
    : text;
}
