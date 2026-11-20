/**
 * 观察消息：把执行结果包装成模型可区分的 user 消息。
 *
 * 观察文本不是系统提示词的一部分，也不会进入 Turn 的固定 Prompt 前缀。
 */

import type { AskHumanResult } from '@archer/contracts';

/**
 * 统一观察外壳。
 *
 * 模型每完成一个动作都会收到一条 user 消息，
 * 用固定前缀区分“工具结果”与真实用户输入。
 */
export function formatObservation(label: string, content: string): string {
  return `[System observation]\n[${label}]\n${content}`;
}

/** 人工观察保留完整回复结果。 */
export function formatOperationResult(result: AskHumanResult): string {
  return JSON.stringify(result, null, 2);
}

/** 动作失败时的观察文本 */
export function formatObservationError(message: string): string {
  return `Error: ${message}`;
}

/** 动作被取消时的观察文本 */
export function formatObservationCancelled(reason: string): string {
  return `Cancelled: ${reason}`;
}

/** Runtime 主动中止执行时的模型可见原因 */
export const EFFECT_OPERATION_CANCELLED = 'Operation was cancelled.';

/** 人工回复观察的模型可见标签。 */
export const HUMAN_RESPONSE_LABEL = 'human response';
