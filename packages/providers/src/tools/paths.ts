/** 工具路径与结果处理；文件路径属于工作环境。 */
import type { Result, KernelError } from '@archer/contracts';

import { ToolInputError } from './types.js';

export function unwrap<T>(result: Result<T, KernelError>): T {
  if (!result.ok) throw new ToolInputError(result.error.message, result.error.code);
  return result.value;
}

export function toolPath(input: string): string {
  if (input.includes('\0') || input.includes('\\') || input.split('/').includes('..')) {
    throw new ToolInputError('Invalid workspace file path.', 'PATH_INVALID');
  }
  return input === '/' ? '/' : input === '.' ? '.' : input.replace(/^\.\//, '').replace(/\/$/, '') || '.';
}
