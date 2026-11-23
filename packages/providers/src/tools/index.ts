/**
 * Archer Harness — 工具目录清单
 *
 * 工具按固定顺序暴露；命令执行由独立的 Shell 工具提供。
 */

import { editTool } from './edit.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { listTool } from './list.js';
import { readTool } from './read.js';
import type { ToolSpec } from './types.js';
import { writeTool } from './write.js';

export function createToolSpecs(): readonly ToolSpec[] {
  const specs: ToolSpec[] = [
    readTool,
    writeTool,
    editTool,
    listTool,
    globTool,
    grepTool,
  ];
  return specs;
}

export { ToolInputError, toolCancelled } from './types.js';
export type { ToolContext, ToolSpec } from './types.js';
