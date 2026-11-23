/**
 * Archer Harness — SSE 事件流协议
 *
 * 事件流是单向、可重连的增量流：服务端推送 SSE，
 * 客户端按 seq / Last-Event-ID 续订。该模块只包含纯协议
 * 逻辑，不依赖 HTTP 框架或浏览器，服务端、CLI 与 Web 共用。
 */

import { z } from 'zod';

/** SSE 响应媒体类型 */
export const SSE_MEDIA_TYPE = 'text/event-stream';

/** 心跳间隔（毫秒） */
export const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

/** 建议的客户端重连间隔（毫秒） */
export const SSE_RETRY_MS = 1_000;

/** 心跳注释帧；客户端解析时忽略 */
export const SSE_HEARTBEAT_FRAME = ': heartbeat\n\n';

/** 续订时使用的请求头 */
export const SSE_LAST_EVENT_ID_HEADER = 'Last-Event-ID';

/** 事件流响应头默认值 */
export const SSE_RESPONSE_HEADERS = {
  'Content-Type': `${SSE_MEDIA_TYPE}; charset=utf-8`,
  'Cache-Control': 'no-cache, no-transform',
  'X-Accel-Buffering': 'no',
} as const;

/** 事件流查询参数：回补 seq 严格大于 afterSeq 的事件 */
export const EventStreamQuerySchema = z.object({
  afterSeq: z.coerce.number().int().nonnegative().default(0),
});

export type EventStreamQuery = z.infer<typeof EventStreamQuerySchema>;

/** 将流标识 + seq 格式化为 SSE 事件 id */
export function formatSseEventId(streamId: string, seq: number): string {
  return `${streamId}:${seq}`;
}

/**
 * 解析 SSE 事件 id，可校验它是否属于指定流。
 *
 * @param value - `streamId:seq` 形式的事件 id
 * @param streamId - 可选的流校验值
 * @returns 合法的 seq，无法解析时返回 null
 */
export function parseSseEventId(
  value: string | null | undefined,
  streamId?: string,
): number | null {
  if (!value) return null;
  const separator = value.lastIndexOf(':');
  if (separator <= 0) return null;
  if (streamId !== undefined && value.slice(0, separator) !== streamId) return null;
  const rawSeq = value.slice(separator + 1);
  if (!/^\d+$/.test(rawSeq)) return null;
  const seq = Number(rawSeq);
  return Number.isSafeInteger(seq) && seq > 0 ? seq : null;
}

/**
 * 计算续订起点。
 *
 * 首次连接使用 afterSeq；重连时取 afterSeq 与 Last-Event-ID 的较大值，
 * 避免两者不一致时重复或漏掉事件。
 *
 * @param query - 已解析的查询参数
 * @param lastEventId - 可选的 Last-Event-ID 请求头
 * @param streamId - 当前事件流的标识
 * @returns 严格大于该值的事件需要发送
 */
export function resolveAfterSeq(
  query: EventStreamQuery,
  lastEventId: string | null | undefined,
  streamId: string,
): number {
  const fromHeader = parseSseEventId(lastEventId, streamId) ?? 0;
  return Math.max(query.afterSeq, fromHeader);
}

function assertSseField(name: string, value: string): void {
  if (value.includes('\n') || value.includes('\r')) {
    throw new Error(`SSE ${name} 不能包含换行符`);
  }
}

/** 一帧待编码的事件 */
export interface SseEvent {
  /** 可恢复事实使用 streamId:seq；临时进度省略 id。 */
  id?: string;
  /** 事件类型，同时用作 SSE event 名称 */
  type: string;
  /** 完整的可序列化负载 */
  data: unknown;
}

/** 将事件编码为 SSE 帧 */
export function encodeSseEvent(event: SseEvent): string {
  if (event.id !== undefined) assertSseField('id', event.id);
  assertSseField('event', event.type);
  return `${event.id === undefined ? '' : `id: ${event.id}\n`}event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/** 编码重连间隔帧 */
export function encodeSseRetry(ms: number): string {
  if (!Number.isSafeInteger(ms) || ms < 0) {
    throw new Error(`SSE retry 必须是非负整数，收到 ${ms}`);
  }
  return `retry: ${ms}\n\n`;
}

/** 解码后的事件帧 */
export interface SseMessage {
  /** 事件 id，对应 `streamId:seq` */
  id?: string;
  /** 事件类型，缺省为 message */
  event: string;
  /** data 字段按行拼接后的原始文本 */
  data: string;
}

interface SseBlockState {
  dataLines: string[];
  eventName?: string;
  hasData: boolean;
}

/**
 * 增量 SSE 解码器。
 *
 * 按规范处理 LF / CRLF / CR 行尾、跨 chunk 截断、注释帧与
 * 多行 data；遇到空行时派发一个完整事件。
 */
export class SseDecoder {
  private buffer = '';
  private bomChecked = false;
  private block: SseBlockState = { dataLines: [], hasData: false };
  private lastEventIdValue: string | null = null;
  private retryValue: number | null = null;

  /** 最近一次有效的 SSE id */
  get lastEventId(): string | null {
    return this.lastEventIdValue;
  }

  /** 服务端建议的重连间隔 */
  get retryMs(): number | null {
    return this.retryValue;
  }

  /**
   * 写入一段文本，返回本次可派发的事件。
   *
   * @param chunk - 可能被任意截断的 SSE 文本
   */
  push(chunk: string): SseMessage[] {
    if (chunk.length === 0) return [];

    if (!this.bomChecked) {
      this.bomChecked = true;
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
    }

    this.buffer += chunk;
    const messages: SseMessage[] = [];
    let line = this.takeLine();
    while (line !== null) {
      this.consumeLine(line, messages);
      line = this.takeLine();
    }
    return messages;
  }

  /** 清空解码器状态 */
  reset(): void {
    this.buffer = '';
    this.bomChecked = false;
    this.block = { dataLines: [], hasData: false };
    this.lastEventIdValue = null;
    this.retryValue = null;
  }

  private takeLine(): string | null {
    const match = /\r\n|\r|\n/.exec(this.buffer);
    if (!match) return null;
    // 末尾的 \r 可能是跨 chunk 的 \r\n，等待下一段
    if (match[0] === '\r' && match.index === this.buffer.length - 1) return null;
    const line = this.buffer.slice(0, match.index);
    this.buffer = this.buffer.slice(match.index + match[0].length);
    return line;
  }

  private consumeLine(line: string, messages: SseMessage[]): void {
    if (line === '') {
      this.dispatch(messages);
      return;
    }
    if (line.startsWith(':')) return;

    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'data':
        this.block.dataLines.push(value);
        this.block.hasData = true;
        break;
      case 'event':
        this.block.eventName = value;
        break;
      case 'id':
        if (!value.includes('\0')) this.lastEventIdValue = value;
        break;
      case 'retry':
        if (/^\d+$/.test(value)) {
          const retry = Number(value);
          if (Number.isSafeInteger(retry)) this.retryValue = retry;
        }
        break;
      default:
        break;
    }
  }

  private dispatch(messages: SseMessage[]): void {
    if (this.block.hasData) {
      const message: SseMessage = {
        event:
          this.block.eventName && this.block.eventName.length > 0
            ? this.block.eventName
            : 'message',
        data: this.block.dataLines.join('\n'),
      };
      if (this.lastEventIdValue !== null) message.id = this.lastEventIdValue;
      messages.push(message);
    }
    this.block = { dataLines: [], hasData: false };
  }
}
