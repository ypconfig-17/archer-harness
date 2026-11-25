/** 会话决策草稿与纯折叠基础设施，不解释模型输出。 */
import type { AgentDraft, AgentInput, Effect, EffectResult, ErrorData, InferConfig,  TurnLimits } from '@archer/contracts';
import { ArcherError } from '@archer/contracts';
import { foldAgentDraft, type SessionState, type SessionTurn } from './session.js';
import type { SessionAgentPolicy } from './policies/function-call.js';
export interface SessionContext {
  now: number;
  /** 本 Agent 的纯决策策略，执行机制不解释模型协议 */
  agentPolicy?: SessionAgentPolicy;
}

export type SessionCommand =
  | { type: 'dispatch_effect'; effectId: string }
  | { type: 'abort_effect'; effectId: string; reason: string };

export interface SessionDecision {
  state: SessionState;
  drafts: AgentDraft[];
  commands: SessionCommand[];
}

export type SessionEffectOutcome =
  | {
      status: 'completed';
      result: EffectResult<Effect>;
      durationMs: number;
    }
  | { status: 'failed'; error: ErrorData; durationMs?: number }
  | { status: 'cancelled'; reason: string }
  | { status: 'unknown'; error: ErrorData };

export interface AcceptedInput {
  command: 'prompt' | 'send' | 'followUp';
  requestId: string;
  input: AgentInput;
  commandMode?: import('@archer/contracts').CommandMode;
  allowShell: boolean;
  inference?: InferConfig;
  limits?: TurnLimits;
  /** 新 Turn 的固定 Prompt 前缀；排队输入在启动 Turn 时由 Runtime 提供 */
  promptFrame?: import('./prompt/types.js').PromptFrame;
}

// ─────────────────────────────────────────────
// 草稿构建
// ─────────────────────────────────────────────

function cloneValue<T>(value: T): T {
  const clone = (globalThis as unknown as {
    structuredClone: <V>(input: V) => V;
  }).structuredClone;
  return clone(value);
}

export function cloneSession(state: SessionState): SessionState {
  return cloneValue(state);
}

/** 仅浅拷贝顶层容器；单 Turn 对象在首次写入时再按需深拷贝，避免长会话下的全量克隆开销。 */
function shallowCloneSession(state: SessionState): SessionState {
  return {
    ...state,
    messages: [...state.messages],
    compactions: [...state.compactions],
    queue: [...state.queue],
    pendingSteering: [...state.pendingSteering],
    turns: new Map(state.turns),
    requests: new Map(state.requests),
  };
}

export class DraftBuilder {
  private current: SessionState | null;
  private readonly clonedTurns = new Set<string>();
  readonly drafts: AgentDraft[] = [];
  readonly commands: SessionCommand[] = [];

  constructor(state: SessionState | null) {
    this.current = state ? shallowCloneSession(state) : null;
  }

  get state(): SessionState {
    if (!this.current) {
      throw new ArcherError('INTERNAL', 'Agent 尚未创建，无法读取会话状态');
    }
    return this.current;
  }

  add(draft: AgentDraft): void {
    if (
      draft.scope === 'turn' &&
      draft.event.type !== 'turn.created' &&
      this.current &&
      !this.clonedTurns.has(draft.turnId)
    ) {
      const existing = this.current.turns.get(draft.turnId);
      if (existing) {
        this.current.turns.set(draft.turnId, cloneValue(existing));
        this.clonedTurns.add(draft.turnId);
      }
    }
    const seq = (this.current?.seq ?? 0) + 1;
    this.current = foldAgentDraft(this.current, draft, seq);
    this.drafts.push(draft);
  }

  agent(event: Extract<AgentDraft, { scope: 'agent' }>['event']): void {
    this.add({ scope: 'agent', event });
  }

  turn(turnId: string, event: Extract<AgentDraft, { scope: 'turn' }>['event']): void {
    this.add({ scope: 'turn', turnId, event });
  }

  finish(): SessionDecision {
    if (!this.current) {
      throw new ArcherError('INTERNAL', '决策没有产生任何事实');
    }
    return { state: this.current, drafts: this.drafts, commands: this.commands };
  }
}

export function decisionOf(state: SessionState): SessionDecision {
  return { state, drafts: [], commands: [] };
}

export function requireTurn(state: SessionState, turnId: string): SessionTurn {
  const turn = state.turns.get(turnId);
  if (!turn) throw new ArcherError('NOT_FOUND', `Turn 不存在：${turnId}`);
  return turn;
}
export function turnOfEffect(state: SessionState, effectId: string): SessionTurn {
  for (const turn of state.turns.values()) {
    if (turn.effects.some((effect) => effect.effectId === effectId)) return turn;
  }
  throw new ArcherError('NOT_FOUND', `Effect 不存在：${effectId}`);
}
export function unapplySteering(builder: DraftBuilder, turn: SessionTurn, reason: string): void {
  const pending = builder.state.pendingSteering.filter((item) => item.turnId === turn.turnId);
  for (const item of pending) {
    builder.agent({
      type: 'steering.unapplied',
      data: { inputId: item.inputId, turnId: turn.turnId, reason },
    });
  }
}
/** 终止或转向时补齐未配对调用，避免下一次推理携带悬空工具请求。 */
export function closeToolCalls(builder: DraftBuilder, turn: SessionTurn, reason: string): void {
  const answered = new Set(builder.state.messages.filter(message => message.role === 'tool').map(message => message.toolCallId));
  for (const message of builder.state.messages) for (const call of message.toolCalls ?? []) {
    if (answered.has(call.id)) continue;
    const execution = turn.effects.find(item => item.effect.type === 'CALL' && item.effect.toolCallId === call.id);
    const completed = execution?.status === 'completed' && execution.effect.type === 'CALL';
    const content = completed ? JSON.stringify((execution.result as import('@archer/contracts').CallResult).value)
      : execution?.status === 'unknown' ? `Execution outcome is unknown. ${reason}`
      : execution?.status === 'failed' ? execution.error?.message ?? reason
      : `Call did not finish executing: ${reason}`;
    builder.turn(turn.turnId, { type: 'message.appended', data: { message: { role: 'tool', content, toolCallId: call.id, toolName: call.name, isError: !completed } } });
    answered.add(call.id);
  }
}

export function settleTurnCancellation(
  builder: DraftBuilder,
  turn: SessionTurn,
  reason: string,
  ctx: SessionContext,
): void {
  closeToolCalls(builder, turn, reason);
  unapplySteering(builder, turn, reason);
  builder.turn(turn.turnId, {
    type: 'turn.cancelled',
    data: { reason, completedAt: ctx.now },
  });
}
export function failTurn(builder: DraftBuilder, turn: SessionTurn, error: ErrorData, ctx: SessionContext): void {
  closeToolCalls(builder, turn, error.message);
  builder.turn(turn.turnId, {
    type: 'turn.failed',
    data: { error, completedAt: ctx.now },
  });
}
