/**
 * Archer Harness — 文件工具的内部类型
 *
 * 工具通过 Tool Contract 提供；每个工具只处理对象载荷并返回输出与已确认的结果细节。
 * 调用审批与 Turn 生命周期由 Runtime 负责；工具文件访问由工作环境约束。
 */

import type { JsonObject, KernelErrorCode, SchemaDescriptor, FileAccess } from '@archer/contracts';
import { OperationRejected } from '@archer/contracts';
import { TOOL_OPERATION_CANCELLED } from './prompt.js';

/** 可预期的工具失败；工具执行边界会将它作为确定性拒绝处理 */
export class ToolInputError extends OperationRejected {
  readonly code: KernelErrorCode;

  constructor(message: string, code: KernelErrorCode = 'PROVIDER_ERROR') {
    super(message);
    this.name = 'ToolInputError';
    this.code = code;
  }
}

/** 工具执行被取消；调用方已中止，不能断言副作用是否发生 */
export function toolCancelled(): ToolInputError {
  return new ToolInputError(TOOL_OPERATION_CANCELLED, 'INTERNAL');
}

/** 工具执行上下文；所有文件访问受调用方工作环境约束 */
export interface ToolContext {
  readonly files: FileAccess;
  readonly signal: AbortSignal;
}

/** 结果细节只来自本次执行，不通过事后读取重建历史。 */
export interface ToolOutput {
  output: string;
  metadata?: JsonObject;
}

/** 一个工具的静态定义 */
export interface ToolSpec {
  readonly name: string;
  /** 宿主界面用的简短说明；模型声明使用 docs。 */
  readonly summary: string;
  readonly schema: SchemaDescriptor;
  readonly docs: string;
  /** 为 true 时，未知异常可能发生在副作用开始之后，provider 必须上抛 */
  readonly mutating: boolean;
  execute(context: ToolContext, payload: unknown): Promise<ToolOutput>;
}
