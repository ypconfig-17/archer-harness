/** 已提交事件的纯展示投影，不负责执行与调度。 */
import type { AgentEvent, Effect, EffectType, Snapshot, InferEffect, InferResult, ImageBlock } from '@archer/contracts';
import { inputText } from './format';

export type TimelineEvent = Snapshot<AgentEvent>;
type AgentScopeEvent = Omit<TimelineEvent, 'fact'> & { fact: Extract<TimelineEvent['fact'], { scope: 'agent' }> };
type TurnScopeEvent = Omit<TimelineEvent, 'fact'> & { fact: Extract<TimelineEvent['fact'], { scope: 'turn' }> };
type TurnFactView = TurnScopeEvent['fact']['event'];
type InputCommand = Extract<
  AgentScopeEvent['fact']['event'],
  { type: 'input.accepted' }
>['data']['command'];
type TerminalFact = Extract<
  TurnFactView,
  { type: 'turn.completed' | 'turn.failed' | 'turn.cancelled' }
>;
type EffectEnd = Extract<
  TurnFactView,
  {
    type:
      | 'effect.completed'
      | 'effect.failed'
      | 'effect.cancelled'
      | 'effect.unknown';
  }
>;

const COMMAND_LABEL: Record<InputCommand, string> = {
  prompt: '发送',
  send: '发送',
  followUp: '排队',
};

export interface InferenceRequestView {
  requestId: string;
  requestedAt?: number;
  summary?: string;
  compactedAt?: number;
  attempt?: number;
  adopted?: boolean;
  purpose: 'agent' | 'compaction';
  request: Snapshot<InferEffect>;
  result?: Snapshot<InferResult>;
  failed?: boolean;
}
export interface EffectEntry {
  inferenceRequests?: InferenceRequestView[];
  effectId: string;
  turnId: string;
  createdAt: number;
  startedAt?: number;
  attempt: number;
  started?: boolean;
  effect?: Snapshot<Effect>;
  effectType?: EffectType;
  suspendedReason?: string;
  humanRequest?: { reason: string; resumed: boolean };
  abandonedReason?: string;
  end?: EffectEnd;
}

type NoticeTone = 'info' | 'warn' | 'success';

export type TimelineItem =
  | { kind: 'notice'; seq: number; text: string; tone: NoticeTone; turnId?: string }
  | {
      kind: 'user';
      images?: readonly ImageBlock[];
      seq: number;
      label: string;
      text: string;
      at: number;
    }
  | { kind: 'turn-start'; seq: number; turnId: string; at: number; note: string | null }
  | { kind: 'effect'; seq: number; turnId: string; entry: EffectEntry }
  | { kind: 'turn-end'; seq: number; turnId: string; fact: TerminalFact };

export function buildItems(events: readonly TimelineEvent[]): TimelineItem[] {
  const entries = new Map<string, EffectEntry>();
  const items: TimelineItem[] = [];

  for (const event of events) {
    if (event.fact.scope === 'agent') {
      const fact = event.fact.event;
      switch (fact.type) {
        case 'agent.created':
          items.push({ kind: 'notice', seq: event.seq, text: 'Agent 已创建', tone: 'success' });
          break;
        case 'input.accepted':
          items.push({
            kind: 'user',
            seq: event.seq,
            label: COMMAND_LABEL[fact.data.command],
            text: inputText(fact.data.input),
            images: typeof fact.data.input === 'string' ? [] : fact.data.input.content.filter(block => block.type === 'image'),
            at: fact.data.receivedAt,
          });
          break;
        case 'input.unapplied':
          items.push({
            kind: 'notice',
            seq: event.seq,
            text: `输入未生效：${fact.data.reason}`,
            tone: 'warn',
          });
          break;
        case 'steering.accepted':
          items.push({
            kind: 'user',
            seq: event.seq,
            label: '引导',
            text: inputText(fact.data.input),
            images: typeof fact.data.input === 'string' ? [] : fact.data.input.content.filter(block => block.type === 'image'),
            at: fact.data.receivedAt,
          });
          break;
        case 'steering.unapplied':
          items.push({
            kind: 'notice',
            seq: event.seq,
            text: `引导未生效：${fact.data.reason}`,
            tone: 'warn',
          });
          break;
        case 'queue.paused':
          items.push({
            kind: 'notice',
            seq: event.seq,
            text: '队列已暂停，恢复后可继续后续任务',
            tone: 'warn',
          });
          break;
        case 'queue.resumed':
          items.push({ kind: 'notice', seq: event.seq, text: '队列已恢复', tone: 'info' });
          break;
        case 'queue.cleared':
          items.push({
            kind: 'notice',
            seq: event.seq,
            text: `已清空队列（${fact.data.inputIds.length} 条输入）`,
            tone: 'info',
          });
          break;
        case 'execution.configured':
          items.push({
            kind: 'notice',
            seq: event.seq,
            text: `执行配置已更新（rev ${fact.data.revision}）`,
            tone: 'info',
          });
          break;
        case 'agent.removed':
          items.push({ kind: 'notice', seq: event.seq, text: 'Agent 已删除', tone: 'warn' });
          break;
        default:
          break;
      }
      continue;
    }

    const { turnId, event: fact } = event.fact;
    switch (fact.type) {
      case 'turn.created': {
        const note = [
          fact.data.allowShell ? fact.data.commandMode === 'full' ? '完全访问' : fact.data.commandMode === 'auto' ? '自动审批' : '每次询问' : null,
          fact.data.limits?.maxInferenceSteps !== undefined
            ? `最多 ${fact.data.limits.maxInferenceSteps} 步`
            : null,
          fact.data.limits?.tokenBudget !== undefined
            ? `预算 ${fact.data.limits.tokenBudget} tokens`
            : null,
        ]
          .filter((part): part is string => part !== null)
          .join(' · ');
        items.push({
          kind: 'turn-start',
          seq: event.seq,
          turnId,
          at: fact.data.createdAt,
          note: note.length > 0 ? note : null,
        });
        break;
      }
      case 'turn.authorization.changed':
        items.push({ kind: 'notice', seq: event.seq, turnId, text: `命令授权已调整：${!fact.data.allowShell ? '关闭' : fact.data.commandMode === 'full' ? '完全访问' : fact.data.commandMode === 'auto' ? '自动审批' : '每次询问'}`, tone: 'info' });
        break;
      case 'turn.status':
        if (fact.data.status === 'waiting') {
          items.push({
            kind: 'notice',
            seq: event.seq,
            text: fact.data.reason ? `等待中：${fact.data.reason}` : '等待中',
            tone: 'warn',
            turnId,
          });
        }
        break;
      case 'turn.cancel.requested':
        items.push({
          kind: 'notice',
          seq: event.seq,
          text: '已请求停止任务，等待执行确认',
          tone: 'warn',
          turnId,
        });
        break;
      case 'effect.created': {
        const entry: EffectEntry = {
          effectId: fact.data.effectId,
          turnId,
          createdAt: fact.data.createdAt,
          attempt: 0,
          effect: fact.data.effect,
          effectType: fact.data.effect.type,
        };
        entries.set(fact.data.effectId, entry);
        items.push({ kind: 'effect', seq: event.seq, turnId, entry });
        break;
      }
      case 'effect.started': {
        const entry = entries.get(fact.data.effectId);
        if (entry) { entry.effectType = fact.data.effectType; entry.started = true; entry.startedAt = fact.data.startedAt; entry.attempt = fact.data.attempt; delete entry.end; }
        break;
      }
      case 'inference.requested': {
        const entry = entries.get(fact.data.effectId);
        if (entry) (entry.inferenceRequests ??= []).push({ requestId: fact.data.requestId, requestedAt: fact.data.requestedAt, attempt: entry.attempt, purpose: fact.data.purpose, request: fact.data.request });
        break;
      }
      case 'inference.responded':
      case 'inference.request.failed': {
        const request = entries.get(fact.data.effectId)?.inferenceRequests?.find(item => item.requestId === fact.data.requestId);
        if (request) {
          if (fact.type === 'inference.responded') request.result = fact.data.result;
          else request.failed = true;
        }
        break;
      }
      case 'context.compacted': {
        // 只有采用事实才能表示整理成功，收到模型响应本身不代表摘要可用。
        const request = entries.get(fact.data.effectId)?.inferenceRequests?.find(item => item.requestId === fact.data.requestId);
        if (request) {
          request.adopted = true;
          request.summary = fact.data.summary;
          request.compactedAt = fact.data.compactedAt;
        }
        break;
      }
      case 'effect.suspended': {
        const entry = entries.get(fact.data.effectId);
        if (entry) {
          entry.suspendedReason = fact.data.reason;
          entry.humanRequest = { reason: fact.data.reason, resumed: false };
        }
        break;
      }
      case 'effect.abandoned': {
        const entry = entries.get(fact.data.effectId);
        if (entry) entry.abandonedReason = fact.data.reason;
        break;
      }
      case 'effect.resumed': {
        const entry = entries.get(fact.data.effectId);
        if (entry) {
          if (fact.data.kind === 'human' && entry.humanRequest) entry.humanRequest.resumed = true;
          delete entry.suspendedReason;
          delete entry.end;
          entry.started = false;
        }
        break;
      }
      case 'effect.completed':
      case 'effect.failed':
      case 'effect.cancelled':
      case 'effect.unknown': {
        const entry = entries.get(fact.data.effectId);
        if (entry) entry.end = fact;
        break;
      }
      case 'turn.completed':
      case 'turn.failed':
      case 'turn.cancelled':
        items.push({ kind: 'turn-end', seq: event.seq, turnId, fact });
        break;
      default:
        break;
    }
  }

  return items;
}

