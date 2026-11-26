/** 摘要交接的可序列化校验；采用简洁 Markdown 分段格式，不再要求模型手写消息索引与逐字引文。 */
import type { Message } from './message.js';

export type NoContextHandoffReason = 'no-useful-information' | 'insufficient-evidence';

/** 无可用交接是模型响应，不是允许丢弃历史的摘要。 */
export class ContextHandoffUnavailable extends Error {
  constructor(readonly reason: NoContextHandoffReason) {
    super(`No usable handoff: ${reason}`);
  }
}

const NO_HANDOFF_RE = /^\[NO_HANDOFF:\s*(no-useful-information|insufficient-evidence)\s*\]$/i;

/**
 * 校验模型生成的 Markdown 交接摘要：
 * - 拒绝空内容、超长内容（> 16,384 字符）或过短的敷衍回复；
 * - 识别模型显式声明的无可用交接标记；
 * - 至少包含结构化标题（`## `）或多行实质性总结。
 */
export function validateContextHandoff(content: string, _source?: readonly Message[]): string {
  if (content.length > 16_384) throw new Error('Handoff exceeds size limit.');
  const trimmed = content.trim();
  if (!trimmed) throw new Error('Empty handoff.');

  const marker = NO_HANDOFF_RE.exec(trimmed);
  if (marker) {
    throw new ContextHandoffUnavailable(marker[1]!.toLowerCase() as NoContextHandoffReason);
  }

  // 兼容模型偶发输出旧式无交接 JSON 标记。
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as { kind?: unknown; reason?: unknown };
      if (
        parsed?.kind === 'no-handoff'
        && (parsed.reason === 'no-useful-information' || parsed.reason === 'insufficient-evidence')
      ) {
        throw new ContextHandoffUnavailable(parsed.reason);
      }
    } catch (error) {
      if (error instanceof ContextHandoffUnavailable) throw error;
    }
  }

  const hasSectionHeading = /^##\s+\S+/m.test(trimmed);
  const nonEmptyLines = trimmed.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (!hasSectionHeading && (nonEmptyLines.length < 2 || trimmed.length < 32)) {
    throw new Error('Handoff lacks structured summary content.');
  }

  return trimmed;
}
