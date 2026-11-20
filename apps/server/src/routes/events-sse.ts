/**
 * Archer Harness — SSE 事件流
 *
 * Agent 流按 Agent seq 续订；Turn 流按 turnSeq 续订并在终止事实后关闭。
 * 只推送已经提交的 AgentEvent / TurnEvent。
 */

import { once } from 'node:events';
import { channel } from 'node:diagnostics_channel';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  SSE_HEARTBEAT_FRAME,
  SSE_HEARTBEAT_INTERVAL_MS,
  SSE_RESPONSE_HEADERS,
  SSE_RETRY_MS,
  encodeSseEvent,
  encodeSseRetry,
  formatSseEventId,
  parseAfterSeqQuery,
  resolveAfterSeq,
  type AgentEvent,
  type Archer,
  type Snapshot,
  type TurnEvent,
} from '@archer/contracts';
import type { AuthHook } from '../auth.js';

export interface EventsSseOptions {
  archer: Archer;
  auth: AuthHook;
}

type StreamEvent = Snapshot<AgentEvent> | Snapshot<TurnEvent>;

async function streamSse(
  request: FastifyRequest,
  reply: FastifyReply,
  streamId: string,
  afterSeq: number,
  events: (signal: AbortSignal) => AsyncIterable<StreamEvent>,
  typeOf: (event: StreamEvent) => string,
): Promise<void> {
  reply.hijack();
  // 接管原始响应后仍保留适配器已设置的跨域等响应头。
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (value !== undefined) reply.raw.setHeader(name, value);
  }
  reply.raw.writeHead(200, SSE_RESPONSE_HEADERS);
  reply.raw.write(encodeSseRetry(SSE_RETRY_MS));

  const controller = new AbortController();
  let closed = false;

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    controller.abort();
    reply.raw.end();
  };

  const heartbeat = setInterval(() => {
    if (!closed) reply.raw.write(SSE_HEARTBEAT_FRAME);
  }, SSE_HEARTBEAT_INTERVAL_MS);

  request.raw.on('close', cleanup);
  reply.raw.on('error', cleanup);

  try {
    for await (const event of events(controller.signal)) {
      if (closed) break;
      if (event.seq <= afterSeq) continue;
      reply.raw.write(
        encodeSseEvent({
          id: formatSseEventId(streamId, event.seq),
          type: typeOf(event),
          data: event,
        }),
      );
      afterSeq = event.seq;
    }
  } catch {
    // 断流由客户端按 Last-Event-ID 续订；此处不改变已提交事实
  } finally {
    cleanup();
  }
}

export function registerEventsSseRoute(
  app: FastifyInstance,
  options: EventsSseOptions,
): void {
  const { archer, auth } = options;

  // 临时进度不带 SSE id，也不接受 afterSeq；重连只获得当前进程的最新帧。
  app.get('/api/agents/:agentId/progress/stream', { preHandler: auth }, async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    if (!await archer.agents.get(agentId)) return reply.code(404).send({ error: `Agent 不存在：${agentId}` });
    reply.hijack();
    for (const [name, value] of Object.entries(reply.getHeaders())) if (value !== undefined) reply.raw.setHeader(name, value);
    reply.raw.writeHead(200, SSE_RESPONSE_HEADERS);
    const controller = new AbortController();
    const cleanup = () => {
      clearInterval(heartbeat);
      controller.abort();
      reply.raw.end();
    };
    const heartbeat = setInterval(() => { reply.raw.write(SSE_HEARTBEAT_FRAME); }, SSE_HEARTBEAT_INTERVAL_MS);
    reply.raw.on('close', cleanup);
    reply.raw.on('error', cleanup);
    try {
      for await (const frame of archer.agents.watchProgress(agentId, { signal: controller.signal })) {
        if (controller.signal.aborted) break;
        const writable = reply.raw.write(encodeSseEvent({ type: 'inference.progress', data: frame }));
        // write 成功只表示交给传输层；页面接收与 React 提交须分别观察。
        const diagnostics = channel('archer.stream');
        if (diagnostics.hasSubscribers) diagnostics.publish({ stage: 'Transport', agentId,
          effectId: frame.effectId, event: frame.phase, content: frame.content.length,
          reasoning: frame.reasoning?.length ?? 0, backpressure: !writable });
        if (!writable) {
          await once(reply.raw, 'drain', { signal: controller.signal });
        }
      }
    } catch {
      // 临时通道可重连，但不补放历史，不改变执行或会话事实。
    } finally { cleanup(); }
  });

  app.get(
    '/api/agents/:agentId/events/stream',
    { preHandler: auth },
    async (request, reply) => {
      const { agentId } = request.params as { agentId: string };
      const agent = await archer.agents.get(agentId);
      if (!agent) {
        return reply.code(404).send({ error: `Agent 不存在：${agentId}` });
      }

      const query = request.query as { afterSeq?: string };
      const afterSeq = resolveAfterSeq(
        { afterSeq: parseAfterSeqQuery(query.afterSeq) },
        request.headers['last-event-id'] as string | undefined,
        agentId,
      );

      await streamSse(
        request,
        reply,
        agentId,
        afterSeq,
        (signal) => archer.agents.watch(agentId, { afterSeq, signal }),
        (event) => ('fact' in event ? event.fact.event.type : event.type),
      );
    },
  );

  app.get(
    '/api/agents/:agentId/turns/:turnId/events/stream',
    { preHandler: auth },
    async (request, reply) => {
      const { agentId, turnId } = request.params as { agentId: string; turnId: string };
      const agent = await archer.agents.get(agentId);
      if (!agent) {
        return reply.code(404).send({ error: `Agent 不存在：${agentId}` });
      }
      const turn = await agent.turns.get(turnId);
      if (!turn) {
        return reply.code(404).send({ error: `Turn 不存在：${turnId}` });
      }

      const streamId = `${agentId}:${turnId}`;
      const query = request.query as { afterSeq?: string };
      const afterSeq = resolveAfterSeq(
        { afterSeq: parseAfterSeqQuery(query.afterSeq) },
        request.headers['last-event-id'] as string | undefined,
        streamId,
      );

      await streamSse(
        request,
        reply,
        streamId,
        afterSeq,
        (signal) => agent.turns.watch(turnId, { afterSeq, signal }),
        (event) => ('type' in event ? event.type : ''),
      );
    },
  );
}
