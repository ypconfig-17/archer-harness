/**
 * Prompt Frame 的类型定义。
 *
 * Frame 将模型固定前缀、内部工具映射和准备安排分开表达；后续推理使用
 * 已提交的 INFER 快照，不在编译阶段读取会话状态。
 */

import type { Message, InferenceTool, Preparation, CapabilityRef } from '@archer/contracts';

export interface CompileTurnPromptInput {
  readonly instructions: string;
  readonly workspace?: import('@archer/contracts').Workspace;
}

/** 一个 Turn 内固定的消息前缀与内部投影输入 */
export interface PromptFrame {
  readonly prefix: readonly Message[];
  /** Runtime 固定的内部工具映射，不属于模型消息正文。 */
  readonly inference?: CapabilityRef;
  readonly tools: readonly InferenceTool[];
  /** 宿主接受的准备安排，不属于模型消息正文。 */
  readonly preparations: readonly Preparation[];
}
