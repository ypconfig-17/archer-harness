/**
 * Archer Harness — 搜索工具的 glob 模式
 *
 * 模式相对工作区根；不含 `/` 的模式按文件名在任意深度匹配。
 * 以 Windows 风格反斜杠或 `..` 段表达的模式会被拒绝，避免路径歧义。
 */

import * as path from 'node:path';
import { TOOL_GLOB_PATTERN_EMPTY, TOOL_GLOB_PATTERN_INVALID } from './prompt.js';
import { ToolInputError } from './types.js';

export function normalizeGlobPattern(pattern: string): string {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) {
    throw new ToolInputError(TOOL_GLOB_PATTERN_EMPTY);
  }
  if (
    trimmed.includes('\\')
    || path.posix.isAbsolute(trimmed)
    || trimmed.split('/').includes('..')
  ) {
    throw new ToolInputError(TOOL_GLOB_PATTERN_INVALID, 'PATH_INVALID');
  }
  return trimmed.includes('/') ? trimmed : `**/${trimmed}`;
}

/** 相对工作区根的路径是否匹配规范化后的模式 */
export function matchesGlob(relativePath: string, pattern: string): boolean {
  try {
    return path.matchesGlob(relativePath, pattern);
  } catch {
    throw new ToolInputError(TOOL_GLOB_PATTERN_INVALID, 'PATH_INVALID');
  }
}
