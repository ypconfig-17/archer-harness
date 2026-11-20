/** 工具消息只选择显式模型正文或通用 JSON，不按固定字符数丢弃执行证据。 */
import type { CallResult } from '@archer/contracts';

export function toolResultContent(result: CallResult): string {
  return result.modelContent ?? JSON.stringify(result.value);
}
