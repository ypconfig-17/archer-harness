/**
 * Archer Harness — 远程 Agent 与 Turn 查询
 *
 * 客户端只维护事件游标，不做调度；命令与查询全部走 HTTP/SSE。
 */

import type {
  AbortOptions,
  Agent,
  AgentEvent,
  AgentInput,
  AgentSnapshot,
  EventReadInput,
  FollowUpOptions,
  PromptOptions,
  ReadOptions,
  Snapshot,
  SteerOptions,
  SubmitOptions,
  TurnEvent,
  TurnListInput,
  TurnQueries,
  TurnRef,
  TurnSnapshot,
  WaitOptions,
  WatchOptions,
} from '@archer/contracts';
import {
  ArcherError,
  validateAgentEvent,
  validateTurnEvent,
  type SseMessage,
} from '@archer/contracts';
import { ApiError, HttpClient } from './http.js';
import { openSseStream } from './sse-stream.js';

function segment(value: string): string {
  return encodeURIComponent(value);
}

function parseAgentEvent(message: SseMessage): AgentEvent | null {
  try {
    const parsed = validateAgentEvent(JSON.parse(message.data));
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

function parseTurnEvent(message: SseMessage): TurnEvent | null {
  try {
    const parsed = validateTurnEvent(JSON.parse(message.data));
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

const TERMINAL_TURN_TYPES = new Set(['turn.completed', 'turn.failed', 'turn.cancelled']);

export async function* watchAgentEvents(
  http: HttpClient,
  agentId: string,
  options: WatchOptions,
): AsyncGenerator<Snapshot<AgentEvent>, void, void> {
  let lastSeq = options.afterSeq;
  for await (const message of openSseStream(
    http,
    `/api/agents/${segment(agentId)}/events/stream`,
    {
      streamId: agentId,
      afterSeq: options.afterSeq,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  )) {
    const event = parseAgentEvent(message);
    if (!event || event.seq <= lastSeq) continue;
    lastSeq = event.seq;
    yield event as Snapshot<AgentEvent>;
    if (event.fact.scope === 'agent' && event.fact.event.type === 'agent.removed') return;
  }
}

export async function* watchTurnEvents(
  http: HttpClient,
  agentId: string,
  turnId: string,
  options: WatchOptions,
): AsyncGenerator<Snapshot<TurnEvent>, void, void> {
  let lastSeq = options.afterSeq;
  for await (const message of openSseStream(
    http,
    `/api/agents/${segment(agentId)}/turns/${segment(turnId)}/events/stream`,
    {
      streamId: `${agentId}:${turnId}`,
      afterSeq: options.afterSeq,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  )) {
    const event = parseTurnEvent(message);
    if (!event || event.seq <= lastSeq) continue;
    lastSeq = event.seq;
    yield event as Snapshot<TurnEvent>;
    if (TERMINAL_TURN_TYPES.has(event.type)) return;
  }
}

function eventQuery(input: EventReadInput): string {
  const params = new URLSearchParams();
  if (input.afterSeq !== undefined) params.set('afterSeq', String(input.afterSeq));
  if (input.beforeSeq !== undefined) params.set('beforeSeq', String(input.beforeSeq));
  if (input.limit !== undefined) params.set('limit', String(input.limit));
  const query = params.toString();
  return query ? `?${query}` : '';
}

export class RemoteTurnQueries implements TurnQueries {
  constructor(
    private readonly http: HttpClient,
    private readonly agentId: string,
  ) {}

  async get(
    turnId: string,
    options: ReadOptions = {},
  ): Promise<Snapshot<TurnSnapshot> | null> {
    try {
      return await this.http.request<Snapshot<TurnSnapshot>>(
        `/api/agents/${segment(this.agentId)}/turns/${segment(turnId)}`,
        options.signal ? { signal: options.signal } : {},
      );
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  async findByRequestId(
    requestId: string,
    options: ReadOptions = {},
  ): Promise<Snapshot<TurnSnapshot> | null> {
    try {
      return await this.http.request<Snapshot<TurnSnapshot>>(
        `/api/agents/${segment(this.agentId)}/turns/by-request/${segment(requestId)}`,
        options.signal ? { signal: options.signal } : {},
      );
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  async list(
    input: TurnListInput = {},
    options: ReadOptions = {},
  ): Promise<readonly Snapshot<TurnSnapshot>[]> {
    const params = new URLSearchParams();
    if (input.beforeAgentSeq !== undefined) {
      params.set('beforeAgentSeq', String(input.beforeAgentSeq));
    }
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    const query = params.toString();
    return this.http.request<readonly Snapshot<TurnSnapshot>[]>(
      `/api/agents/${segment(this.agentId)}/turns${query ? `?${query}` : ''}`,
      options.signal ? { signal: options.signal } : {},
    );
  }

  async events(
    turnId: string,
    input: EventReadInput = {},
    options: ReadOptions = {},
  ): Promise<readonly Snapshot<TurnEvent>[]> {
    return this.http.request<readonly Snapshot<TurnEvent>[]>(
      `/api/agents/${segment(this.agentId)}/turns/${segment(turnId)}/events${eventQuery(input)}`,
      options.signal ? { signal: options.signal } : {},
    );
  }

  watch(
    turnId: string,
    options: WatchOptions,
  ): AsyncIterable<Snapshot<TurnEvent>> {
    return watchTurnEvents(this.http, this.agentId, turnId, options);
  }
}

function submitBody(
  input: AgentInput,
  options: SubmitOptions,
): Record<string, unknown> {
  return {
    input,
    ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
    ...(options.commandMode === undefined ? {} : { commandMode: options.commandMode }),
    ...(options.allowShell === undefined ? {} : { allowShell: options.allowShell }),
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...(options.inference === undefined ? {} : { inference: options.inference }),
  };
}

function aborted(): ArcherError {
  return new ArcherError('ABORTED', '等待已取消');
}

export class RemoteAgent implements Agent {
  readonly turns: TurnQueries;

  constructor(
    private readonly http: HttpClient,
    readonly id: string,
  ) {
    this.turns = new RemoteTurnQueries(http, id);
  }

  private async command(
    pathname: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      await this.http.request<void>(`/api/agents/${segment(this.id)}${pathname}`, {
        method: 'POST',
        body: JSON.stringify(body),
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error: unknown) {
      if (signal?.aborted) throw aborted();
      throw error;
    }
  }

  async prompt(input: AgentInput, options: PromptOptions = {}): Promise<void> {
    await this.command('/prompt', submitBody(input, options), options.signal);
  }

  async send(input: AgentInput, options: SubmitOptions = {}): Promise<TurnRef> {
    return this.http.request<TurnRef>(`/api/agents/${segment(this.id)}/send`, {
      method: 'POST',
      body: JSON.stringify(submitBody(input, options)),
    });
  }

  async steer(input: AgentInput, options: SteerOptions = {}): Promise<void> {
    await this.command('/steer', {
      input,
      ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
      ...(options.turnId === undefined ? {} : { turnId: options.turnId }),
    });
  }

  async followUp(input: AgentInput, options: FollowUpOptions = {}): Promise<void> {
    await this.command('/follow-up', {
      input,
      ...(options.inference === undefined ? {} : { inference: options.inference }),
      ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
    });
  }

  async abort(options: AbortOptions = {}): Promise<void> {
    await this.command('/abort', {
      ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
      ...(options.turnId === undefined ? {} : { turnId: options.turnId }),
      ...(options.reason === undefined ? {} : { reason: options.reason }),
    });
  }

  async wait(turnId: string, options: WaitOptions = {}): Promise<void> {
    await this.command(
      `/turns/${segment(turnId)}/wait`,
      {},
      options.signal,
    );
  }

  getState(options: ReadOptions = {}): Promise<Snapshot<AgentSnapshot>> {
    return this.http.request<Snapshot<AgentSnapshot>>(
      `/api/agents/${segment(this.id)}`,
      options.signal ? { signal: options.signal } : {},
    );
  }

  events(
    input: EventReadInput = {},
    options: ReadOptions = {},
  ): Promise<readonly Snapshot<AgentEvent>[]> {
    return this.http.request<readonly Snapshot<AgentEvent>[]>(
      `/api/agents/${segment(this.id)}/events${eventQuery(input)}`,
      options.signal ? { signal: options.signal } : {},
    );
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    const controller = new AbortController();
    void (async () => {
      try {
        const state = await this.getState({ signal: controller.signal });
        for await (const event of watchAgentEvents(this.http, this.id, {
          afterSeq: state.seq,
          signal: controller.signal,
        })) {
          listener(event as AgentEvent);
        }
      } catch {
        // 订阅连接失败或已关闭；调用方通过事件流查询补齐
      }
    })();
    return () => controller.abort();
  }
}
