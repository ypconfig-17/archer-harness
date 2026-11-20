/**
 * Archer Harness — SSE 增量流
 *
 * 只负责按 seq 续订与断线重连；事件解析由调用方完成。
 */

import { SseDecoder, parseSseEventId, type SseMessage } from '@archer/contracts';
import { ApiError, HttpClient } from './http.js';

export interface SseStreamOptions {
  streamId?: string;
  afterSeq?: number;
  signal?: AbortSignal;
  reconnectDelayMs?: number;
}

const DEFAULT_RECONNECT_DELAY_MS = 1000;

function fatalStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 404;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

export async function* openSseStream(
  http: HttpClient,
  pathname: string,
  options: SseStreamOptions,
): AsyncGenerator<SseMessage, void, void> {
  const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  const external = options.signal ?? new AbortController().signal;
  let afterSeq = options.afterSeq;

  while (!external.aborted) {
    const connection = new AbortController();
    const onAbort = (): void => connection.abort();
    external.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await http.openStream(
        afterSeq === undefined ? pathname : `${pathname}?afterSeq=${afterSeq}`,
        { signal: connection.signal },
      );
      if (!response.ok || !response.body) {
        throw new ApiError(`SSE 连接失败（HTTP ${response.status}）`, response.status);
      }

      const reader = response.body.getReader();
      const text = new TextDecoder();
      const sse = new SseDecoder();

      try {
        while (!external.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          for (const message of sse.push(text.decode(chunk.value, { stream: true }))) {
            const seq = options.streamId === undefined || message.id === undefined
              ? null
              : parseSseEventId(message.id, options.streamId);
            if (seq !== null) afterSeq = seq;
            yield message;
          }
        }
      } finally {
        connection.abort();
        reader.releaseLock();
      }
    } catch (error: unknown) {
      if (external.aborted) return;
      if (error instanceof ApiError && fatalStatus(error.status)) throw error;
      await delay(reconnectDelayMs, external);
      continue;
    } finally {
      external.removeEventListener('abort', onAbort);
    }

    if (external.aborted) return;
    await delay(reconnectDelayMs, external);
  }
}
