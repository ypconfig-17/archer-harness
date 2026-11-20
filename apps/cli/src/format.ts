/**
 * Archer Harness CLI — 终端输出
 */

import type {
  AgentEvent,
  AgentSnapshot,
  AgentSummary,
  Effect,
  Snapshot,
  TurnEvent,
  TurnSnapshot,
} from '@archer/contracts';
import { log } from '@clack/prompts';

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

export function truncate(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Turn id 前缀是 Agent id；终端展示只保留 Turn 序号 */
export function shortTurnId(turnId: string): string {
  const separator = turnId.lastIndexOf(':');
  return separator === -1 ? turnId : turnId.slice(separator + 1);
}

/** 提取 assistant 输出中的 message */
export function assistantText(content: string): string {
  return content.trim();
}

function effectLabel(effect: Snapshot<Effect>): string {
  switch (effect.type) {
    case 'INFER':
      return '请求推理';
    case 'CALL':
      return `调用 ${`${effect.target.providerId}.${effect.target.capabilityId}`}`;
    case 'ASK_HUMAN':
      return `请求人工确认：${effect.reason}`;
    case 'SPAWN':
      return `派生子 Agent：${effect.spec.name}`;
    case 'COMPACT':
      return `压缩上下文（约 ${effect.currentTokens} tokens）`;
    case 'ABORT':
      return `中止：${effect.reason}`;
  }
}

function summarizeResult(result: unknown, effectType: Effect['type']): string {
  if (result === null || result === undefined) return '';
  if (effectType === 'INFER' && typeof result === 'object' && 'content' in result) {
    return truncate(assistantText(String((result as { content: unknown }).content)));
  }
  if (typeof result === 'string') return truncate(result);
  if (typeof result === 'object') {
    const record = result as Record<string, unknown>;
    if (typeof record.content === 'string') return truncate(record.content);
    if (typeof record.output === 'string') return truncate(record.output);
    if (typeof record.summary === 'string') return truncate(record.summary);
    if (record.error && typeof record.error === 'object' && 'message' in record.error) {
      return truncate(String((record.error as { message: unknown }).message));
    }
    if (typeof record.error === 'string') return truncate(record.error);
  }
  return truncate(JSON.stringify(result));
}

export function renderTurnEvent(event: Snapshot<TurnEvent>, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(event));
    return;
  }

  switch (event.type) {
    case 'turn.created':
      log.info(`Turn ${shortTurnId(event.turnId)} 已创建`);
      break;
    case 'turn.status':
      log.warn(
        `状态更新：${event.data.status}${event.data.reason ? `（${event.data.reason}）` : ''}`,
      );
      break;
    case 'turn.cancel.requested':
      log.warn(`收到取消请求：${event.data.reason}`);
      break;
    case 'message.appended':
      if (event.data.message.role === 'user') {
        log.info(`用户：${truncate(event.data.message.content, 240)}`);
      } else if (event.data.message.role === 'assistant') {
        const text = assistantText(event.data.message.content);
        if (text) log.info(`助手：${truncate(text, 240)}`);
      }
      break;
    case 'completion.review.requested':
      log.info('完成前复核：检查文件变更、验证结果与剩余限制');
      return;
    case 'inference.started':
      log.info(`第 ${event.data.step} 步推理`);
      break;
    case 'inference.planned':
      log.info(
        `计划 ${event.data.actions.length} 个动作${
          event.data.terminal ? `，终止：${event.data.terminal.kind}` : ''
        }`,
      );
      break;
    case 'effect.created':
      log.step(effectLabel(event.data.effect));
      break;
    case 'effect.completed': {
      const summary = summarizeResult(event.data.result, event.data.effectType);
      log.info(
        `完成 ${event.data.effectType}（${event.data.durationMs}ms）${
          summary ? `：${summary}` : ''
        }`,
      );
      break;
    }
    case 'effect.failed':
      log.error(`${event.data.effectType} 失败：${event.data.error.message}`);
      break;
    case 'effect.suspended':
      log.warn(`等待人类输入：${event.data.reason}`);
      break;
    case 'effect.unknown':
      log.warn('副作用结果未知，等待人工对账');
      break;
    case 'effect.abandoned':
      log.warn(`已放弃追踪：${event.data.reason}（原操作结果仍未知）`);
      break;
    case 'turn.completed':
      log.success(
        `Turn 完成${event.data.summary ? `：${truncate(event.data.summary, 240)}` : ''}`,
      );
      break;
    case 'turn.failed':
      log.error(`Turn 失败：${event.data.error.message}`);
      break;
    case 'turn.cancelled':
      log.warn(`Turn 已取消${event.data.reason ? `：${event.data.reason}` : ''}`);
      break;
    default:
      break;
  }
}

export function renderAgentEvent(event: Snapshot<AgentEvent>, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(event));
    return;
  }
  if (event.fact.scope === 'turn') {
    renderTurnEvent({
      id: event.id,
      agentId: event.agentId,
      turnId: event.fact.turnId,
      agentSeq: event.seq,
      seq: event.fact.turnSeq,
      ts: event.ts,
      ...event.fact.event,
    } as Snapshot<TurnEvent>, false);
    return;
  }
  console.log(`[${event.seq}] ${event.fact.event.type}`);
}

export function printAgentTable(agents: readonly Snapshot<AgentSummary>[]): void {
  if (agents.length === 0) {
    log.info('暂无 Agent');
    return;
  }

  const header = ['ID', 'SEQ', '活跃 Turn', '队列'];
  const rows = agents.map((agent) => [
    agent.id,
    String(agent.seq),
    agent.activeTurnId ? shortTurnId(agent.activeTurnId) : '-',
    agent.queuePaused ? '暂停' : '运行',
  ]);

  const widths = header.map((title, index) =>
    Math.max(title.length, ...rows.map((row) => row[index].length)),
  );
  const renderRow = (row: string[]): string =>
    row.map((cell, index) => cell.padEnd(widths[index])).join('  ');

  console.log(renderRow(header));
  console.log(widths.map((width) => '─'.repeat(width)).join('  '));
  for (const row of rows) console.log(renderRow(row));
}

export function printTurnTable(turns: readonly Snapshot<TurnSnapshot>[]): void {
  if (turns.length === 0) {
    log.info('暂无 Turn');
    return;
  }

  const header = ['TURN', '状态', 'SEQ', '等待'];
  const rows = turns.map((turn) => [
    shortTurnId(turn.turnId),
    turn.status,
    String(turn.seq),
    turn.pending ? turn.pending.kind : '-',
  ]);

  const widths = header.map((title, index) =>
    Math.max(title.length, ...rows.map((row) => row[index].length)),
  );
  const renderRow = (row: string[]): string =>
    row.map((cell, index) => cell.padEnd(widths[index])).join('  ');

  console.log(renderRow(header));
  console.log(widths.map((width) => '─'.repeat(width)).join('  '));
  for (const row of rows) console.log(renderRow(row));
}

export function printAgentDetail(agent: Snapshot<AgentSnapshot>): void {
  console.log(`Agent：${agent.id}`);
  console.log(`序号：${agent.seq}`);
  console.log(`执行状态：${agent.execution}`);
  console.log(`指令：${truncate(agent.instructions, 240)}`);
  console.log(`执行配置 revision：${agent.executionRevision}`);
  console.log(`消息数：${agent.messages.length}`);
  console.log(`队列：${agent.queuedInputs.length} 条`);
  if (agent.activeTurn) {
    console.log(
      `活跃 Turn：${agent.activeTurn.turnId}（${agent.activeTurn.status}）`,
    );
  }
  if (agent.fault) console.log(`故障：${agent.fault.code} ${agent.fault.message}`);
}
