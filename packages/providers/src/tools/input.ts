/**
 * Archer Harness — 工具载荷读取
 *
 * 工具只接受 JSON 对象载荷；字段错误统一转换为 ToolInputError，由 provider
 * 记录为确定性失败，不产生未知副作用。
 */

import {
  TOOL_PAYLOAD_MUST_BE_OBJECT,
  toolFieldMustBeBoolean,
  toolFieldMustBeInteger,
  toolFieldMustBeNonEmptyString,
  toolFieldMustBeString,
} from './prompt.js';
import { ToolInputError } from './types.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readText(input: unknown, key: string): string {
  if (!isRecord(input)) throw new ToolInputError(TOOL_PAYLOAD_MUST_BE_OBJECT);
  const value = input[key];
  if (typeof value !== 'string') {
    throw new ToolInputError(toolFieldMustBeString(key));
  }
  return value;
}

export function readString(input: unknown, key: string): string {
  const value = readText(input, key);
  if (value.trim() === '') {
    throw new ToolInputError(toolFieldMustBeNonEmptyString(key));
  }
  return value;
}

export function readOptionalString(input: unknown, key: string): string | undefined {
  if (!isRecord(input) || input[key] === undefined) return undefined;
  return readString(input, key);
}

export function readBoolean(input: unknown, key: string): boolean | undefined {
  if (!isRecord(input) || input[key] === undefined) return undefined;
  const value = input[key];
  if (typeof value !== 'boolean') {
    throw new ToolInputError(toolFieldMustBeBoolean(key));
  }
  return value;
}

export function readInteger(
  input: unknown,
  key: string,
  min: number,
  max?: number,
): number | undefined {
  if (!isRecord(input) || input[key] === undefined) return undefined;
  const value = input[key];
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < min
    || (max !== undefined && value > max)
  ) {
    throw new ToolInputError(toolFieldMustBeInteger(key, min, max));
  }
  return value;
}

/** 目标文件的 CAS 条件属于工具载荷，不是 executable 自身的 revision */
export function readExpectedRevision(input: unknown): string | null | undefined {
  if (!isRecord(input) || input.expectedRevision === undefined) return undefined;
  if (input.expectedRevision === null || typeof input.expectedRevision === 'string') return input.expectedRevision;
  throw new ToolInputError('"expectedRevision" must be a string or null.');
}
