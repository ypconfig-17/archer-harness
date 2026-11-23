/**
 * SSE 事件流协议测试。
 */

import { describe, expect, it } from 'vitest';
import {
  AgentEventSchema,
  EventStreamQuerySchema,
  SSE_HEARTBEAT_FRAME,
  SSE_LAST_EVENT_ID_HEADER,
  SSE_RESPONSE_HEADERS,
  SseDecoder,
  encodeSseEvent,
  encodeSseRetry,
  formatSseEventId,
  parseSseEventId,
  resolveAfterSeq,
  type AgentEvent,
  type SseEvent,
} from '@archer/contracts';

const completedEvent: AgentEvent = {
  id: 'agent-1:8',
  agentId: 'agent-1',
  seq: 8,
  ts: 1_700_000_000_008,
  fact: {
    scope: 'turn',
    turnId: 'turn-1',
    turnSeq: 3,
    event: {
      type: 'turn.completed',
      data: { summary: '完成', stopReason: 'done', completedAt: 1_700_000_000_008 },
    },
  },
};

const cancelledFrame: SseEvent = {
  id: formatSseEventId('agent-1', 7),
  type: 'turn.cancelled',
  data: {
    id: 'agent-1:7',
    agentId: 'agent-1',
    seq: 7,
    ts: 1_700_000_000_007,
    fact: {
      scope: 'turn',
      turnId: 'turn-1',
      turnSeq: 2,
      event: {
        type: 'turn.cancelled',
        data: { reason: '测试取消', completedAt: 1_700_000_000_007 },
      },
    },
  } satisfies AgentEvent,
};

const completedFrame: SseEvent = {
  id: formatSseEventId('agent-1', 8),
  type: 'turn.completed',
  data: completedEvent,
};

describe('SSE 事件编码', () => {
  it('输出 id / event / data 帧并以空行结束', () => {
    const frame = encodeSseEvent(cancelledFrame);

    expect(frame.startsWith('id: agent-1:7\n')).toBe(true);
    expect(frame).toContain('event: turn.cancelled\n');
    expect(frame.endsWith('\n\n')).toBe(true);
    expect(frame.split('\n').filter((line) => line.startsWith('data: '))).toHaveLength(1);

    const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
    if (!dataLine) throw new Error('缺少 data 行');
    const parsed: unknown = JSON.parse(dataLine.slice('data: '.length));
    expect(parsed).toEqual(cancelledFrame.data);
    expect(AgentEventSchema.parse(parsed)).toEqual(cancelledFrame.data);
  });

  it('payload 中的换行不会破坏帧结构', () => {
    const event: SseEvent = {
      ...cancelledFrame,
      data: {
        ...(cancelledFrame.data as AgentEvent),
        fact: {
          scope: 'turn',
          turnId: 'turn-1',
          turnSeq: 2,
          event: {
            type: 'turn.cancelled',
            data: { reason: '第一行\n第二行', completedAt: 1_700_000_000_007 },
          },
        },
      },
    };
    const frame = encodeSseEvent(event);
    expect(frame.split('\n').filter((line) => line.startsWith('data: '))).toHaveLength(1);

    const [message] = new SseDecoder().push(frame);
    if (!message) throw new Error('未解析出含换行 payload 的事件');
    expect(JSON.parse(message.data)).toEqual(event.data);
  });

  it('拒绝包含换行的 id 或事件类型', () => {
    expect(() => encodeSseEvent({ ...cancelledFrame, id: 'agent-1:7\nid: forged' }))
      .toThrow('换行');
    expect(() => encodeSseEvent({ ...cancelledFrame, type: 'turn.cancelled\n' }))
      .toThrow('换行');
  });

  it('提供心跳帧与合法重连间隔', () => {
    expect(SSE_HEARTBEAT_FRAME).toBe(': heartbeat\n\n');
    expect(encodeSseRetry(1500)).toBe('retry: 1500\n\n');
    expect(() => encodeSseRetry(-1)).toThrow();
    expect(() => encodeSseRetry(1.5)).toThrow();
  });

  it('声明不缓存、不转换、不被代理缓冲的响应头', () => {
    expect(SSE_RESPONSE_HEADERS['Content-Type']).toBe('text/event-stream; charset=utf-8');
    expect(SSE_RESPONSE_HEADERS['Cache-Control']).toContain('no-transform');
    expect(SSE_RESPONSE_HEADERS['X-Accel-Buffering']).toBe('no');
    expect(SSE_LAST_EVENT_ID_HEADER).toBe('Last-Event-ID');
  });
});

describe('SseDecoder', () => {
  it('解析单条事件并保留 lastEventId', () => {
    const decoder = new SseDecoder();
    const [message] = decoder.push(encodeSseEvent(cancelledFrame));

    if (!message) throw new Error('未解析出事件');
    expect(message.id).toBe('agent-1:7');
    expect(message.event).toBe('turn.cancelled');
    expect(JSON.parse(message.data)).toEqual(cancelledFrame.data);
    expect(decoder.lastEventId).toBe('agent-1:7');
  });

  it('支持跨 chunk 截断，且在空行前不派发', () => {
    const decoder = new SseDecoder();
    const frame = encodeSseEvent(cancelledFrame);
    const midpoint = Math.floor(frame.length / 2);

    expect(decoder.push(frame.slice(0, midpoint))).toEqual([]);
    expect(decoder.push(frame.slice(midpoint))).toHaveLength(1);

    const second = new SseDecoder();
    expect(second.push('event: turn.started\ndata: {}')).toEqual([]);
    expect(second.push('\n\n')).toHaveLength(1);
  });

  it('处理跨 chunk 的 CRLF 行尾', () => {
    const decoder = new SseDecoder();
    expect(decoder.push('data: 第一行\r')).toEqual([]);
    const [message] = decoder.push('\n\r\n');

    if (!message) throw new Error('未解析出 CRLF 事件');
    expect(message.data).toBe('第一行');
  });

  it('拼接多行 data，忽略注释与未知字段', () => {
    const decoder = new SseDecoder();
    const messages = decoder.push(
      ': ping\nunknown: value\ndata: 第一行\ndata: 第二行\n\n',
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.data).toBe('第一行\n第二行');
  });

  it('空 data 字段也会派发空事件', () => {
    const [message] = new SseDecoder().push('data:\n\n');
    if (!message) throw new Error('未解析出空 data 事件');
    expect(message.data).toBe('');
    expect(message.event).toBe('message');
  });

  it('忽略心跳注释，记录 retry 并支持 BOM', () => {
    const decoder = new SseDecoder();
    expect(decoder.push(SSE_HEARTBEAT_FRAME)).toEqual([]);
    expect(decoder.push('retry: 2500\n\n')).toEqual([]);
    expect(decoder.retryMs).toBe(2500);

    const [message] = new SseDecoder().push('\uFEFFdata: 内容\n\n');
    if (!message) throw new Error('未解析出 BOM 事件');
    expect(message.data).toBe('内容');
  });

  it('一次 push 可解析多条事件', () => {
    const decoder = new SseDecoder();
    const messages = decoder.push(
      encodeSseEvent(cancelledFrame) + SSE_HEARTBEAT_FRAME + encodeSseEvent(completedFrame),
    );

    expect(messages.map((message) => message.id)).toEqual(['agent-1:7', 'agent-1:8']);
    expect(messages.map((message) => message.event)).toEqual([
      'turn.cancelled',
      'turn.completed',
    ]);
  });

  it('reset 后不保留旧连接状态', () => {
    const decoder = new SseDecoder();
    decoder.push(encodeSseEvent(cancelledFrame));
    decoder.reset();

    expect(decoder.lastEventId).toBeNull();
    expect(decoder.push('data: 新内容')).toEqual([]);
    expect(decoder.push('\n\n')).toHaveLength(1);
  });

  it('事件可通过编码、解码与 Schema 校验识别', () => {
    const [message] = new SseDecoder().push(encodeSseEvent(completedFrame));
    if (!message) throw new Error('未解析出事件');
    const event = AgentEventSchema.parse(JSON.parse(message.data));
    expect(event.fact.scope).toBe('turn');
    if (event.fact.scope === 'turn') {
      expect(event.fact.event.type).toBe('turn.completed');
    }
  });
});

describe('SSE 事件游标', () => {
  it('格式化并解析 streamId:seq', () => {
    expect(formatSseEventId('agent-1', 7)).toBe('agent-1:7');
    expect(formatSseEventId('agent-1:turn-1', 3)).toBe('agent-1:turn-1:3');
    expect(parseSseEventId('agent-1:7')).toBe(7);
    expect(parseSseEventId('agent-1:7', 'agent-1')).toBe(7);
    expect(parseSseEventId('agent-1:turn-1:3', 'agent-1:turn-1')).toBe(3);
    expect(parseSseEventId('agent-2:7', 'agent-1')).toBeNull();
    expect(parseSseEventId('agent-1:0')).toBeNull();
    expect(parseSseEventId('agent-1:-1')).toBeNull();
    expect(parseSseEventId('agent-1:1.5')).toBeNull();
    expect(parseSseEventId('agent-1:abc')).toBeNull();
    expect(parseSseEventId('')).toBeNull();
    expect(parseSseEventId(null)).toBeNull();
  });

  it('续订起点取 query 与 Last-Event-ID 的较大值', () => {
    expect(resolveAfterSeq({ afterSeq: 5 }, 'agent-1:9', 'agent-1')).toBe(9);
    expect(resolveAfterSeq({ afterSeq: 10 }, 'agent-1:9', 'agent-1')).toBe(10);
    expect(resolveAfterSeq({ afterSeq: 0 }, undefined, 'agent-1')).toBe(0);
    expect(resolveAfterSeq({ afterSeq: 3 }, 'other:9', 'agent-1')).toBe(3);
  });
});

describe('事件流查询参数', () => {
  it('缺省从 0 开始，并接受字符串数字', () => {
    expect(EventStreamQuerySchema.parse({})).toEqual({ afterSeq: 0 });
    expect(EventStreamQuerySchema.parse({ afterSeq: '42' })).toEqual({ afterSeq: 42 });
  });

  it('拒绝负数、小数和非数字', () => {
    for (const value of ['-1', '1.5', 'abc']) {
      expect(EventStreamQuerySchema.safeParse({ afterSeq: value }).success).toBe(false);
    }
  });
});

it('临时进度帧省略 id，不制造可重放的日志游标', () => {
  const frame = encodeSseEvent({ type: 'inference.progress', data: { content: 'partial' } });
  expect(frame).not.toContain('id:');
  expect(frame).toContain('event: inference.progress');
});
