/** 列出调用方工作环境目录， */
import { fileKindLabel, TOOL_LIST_SUMMARY, TOOL_LIST_DOCS, TOOL_LIST_EMPTY, TOOL_LIST_SCHEMA, toolListHeading } from './prompt.js';
import { readString } from './input.js';
import { toolPath, unwrap } from './paths.js';
import type { ToolSpec } from './types.js';

export const listTool: ToolSpec = {
  name: 'list', summary: TOOL_LIST_SUMMARY, schema: TOOL_LIST_SCHEMA,
  docs: TOOL_LIST_DOCS, mutating: false,
  async execute(context, payload) {
    const path = toolPath(readString(payload, 'path'));
    const entries = unwrap(await context.files.list(path));
    return { output: `${toolListHeading(path)}\n${entries.map((entry) => `[${fileKindLabel(entry.kind)}] ${entry.name} — ${entry.description}`).join('\n') || TOOL_LIST_EMPTY}`, metadata: { listing: { path, count: entries.length } } };
  },
};
