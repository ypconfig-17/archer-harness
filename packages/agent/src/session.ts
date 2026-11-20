/**
 * Archer Harness — Agent 会话状态与事实折叠
 *
 * 一个 Agent 一份状态：身份、执行配置、消息、队列与全部 Turn。
 * 折叠只消费已提交事实，不读取外部状态，也不执行 I/O。
 */

import type {
  ActionPlan,
  AgentDraft,
  AgentEvent,
  AgentSnapshot,
  Effect,
  EffectResult,
  EffectStatus,
  ErrorData,
  InferConfig,
  Message,
  PendingInput,
  QueuedInput,
  TurnLimits,
  TurnSnapshot,
  TurnStatus,
  TurnTerminal,
} from '@archer/contracts';
import {
  ArcherError, validateContextHandoff, InferEffectSchema, InferResultSchema, canonicalJson,
  isTerminalTurnStatus,
  validateEffectResult,
} from '@archer/contracts';

// ─────────────────────────────────────────────
// 状态
// ─────────────────────────────────────────────

export interface SessionLimits {
  maxInferenceSteps?: number;
  tokenBudget?: number;
}

/** 每次真实模型请求独立留痕；未确认请求的用量保持未知。 */
export interface SessionInferenceRequest {
  requestId: string;
  attempt: number;
  purpose: 'agent' | 'compaction';
  request: import('@archer/contracts').InferEffect;
  status: 'requested' | 'completed' | 'failed';
  result?: import('@archer/contracts').InferResult;
  error?: ErrorData;
}

export interface SessionCompaction {
  effectId: string;
  requestId: string;
  coveredMessageCount: number;
  summary: string;
}

export interface SessionEffect {
  effectId: string;
  effect: Effect;
  idempotencyKey: string;
  inferenceStep: number;
  status: EffectStatus;
  attempt: number;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  result?: EffectResult<Effect>;
  error?: ErrorData;
  reason?: string;
  commandApproved?: boolean;
  inferenceRequests: SessionInferenceRequest[];
  suspended?: {
    reason: string;
    resumeTokenHash: string;
    expiresAt?: number;
  };
  unknown?: { detectedAt: number };
  /** 人工放弃追踪不改变 unknown 的外部结果事实。 */
  abandoned?: { reason: string; at: number };
}

export interface SessionPlan {
  actions: ActionPlan[];
  nextIndex: number;
  terminal?: TurnTerminal;
}

export interface SessionTurn {
  turnId: string;
  /** turn.created 事件的 Agent seq */
  agentSeq: number;
  /** 该 Turn 子序列的最后序号 */
  seq: number;
  inputId: string;
  status: TurnStatus;
  commandMode?: import('@archer/contracts').CommandMode;
  allowShell: boolean;
  inference?: InferConfig;
  limits: SessionLimits;
  createdAt: number;
  inferenceSteps: number;
  /** 最近一次已经提交结束复核的操作边界，避免同一状态无限追问。 */
  completionReviewAfter?: string;
  plan: SessionPlan | null;
  effects: SessionEffect[];
  pending: PendingInput | null;
  cancel: { reason?: string; requestedAt: number } | null;
  stopReason?: 'done' | 'respond';
  summary?: string;
  error?: ErrorData;
  completedAt?: number;
}

export type RequestCommand = 'prompt' | 'send' | 'followUp' | 'steer' | 'abort' | 'resumeQueue' | 'clearQueue';

export interface SessionRequest {
  command: RequestCommand;
  signature: string;
  inputId?: string;
  turnId?: string;
}

/** 队列中的输入保留提交时固化的执行选项 */
export interface SessionQueuedInput extends QueuedInput {
  commandMode?: import('@archer/contracts').CommandMode;
  allowShell: boolean;
  inference?: InferConfig;
  limits?: TurnLimits;
}

export interface SessionState {
  workspace?: import('@archer/contracts').Workspace;
  /** 恢复时校验的纯决策策略标识 */
  policyId: string;
  agentId: string;
  seq: number;
  createdAt: number;
  /** 规范化创建声明的摘要；用于 create 幂等判定 */
  createKey: string;
  /** 用户确认的会话标题；未重命名时缺省 */
  title?: string;
  instructions: string;
  inference: InferConfig;
  executionRevision: number;
  messages: Message[];
  compactions: SessionCompaction[];
  queue: SessionQueuedInput[];
  queuePaused: boolean;
  pendingSteering: Array<QueuedInput & { turnId: string }>;
  activeTurnId: string | null;
  turns: Map<string, SessionTurn>;
  requests: Map<string, SessionRequest>;
  /** 已接收输入总数；用于生成稳定的 inputId */
  inputCount: number;
  removed: boolean;
  removedAt?: number;
}

// ─────────────────────────────────────────────
// 构造与只读投影
// ─────────────────────────────────────────────

export function activeTurnOf(state: SessionState): SessionTurn | null {
  return state.activeTurnId === null ? null : state.turns.get(state.activeTurnId) ?? null;
}

export function lastEffectOf(turn: SessionTurn): SessionEffect | null {
  return turn.effects.at(-1) ?? null;
}

export function hasPendingEffect(turn: SessionTurn): boolean {
  const effect = lastEffectOf(turn);
  if (!effect) return false;
  return effect.status === 'created'
    || effect.status === 'started'
    || effect.status === 'resumed'
    || effect.status === 'suspended'
    || effect.status === 'unknown';
}

export function isTurnActive(turn: SessionTurn | null): boolean {
  return turn !== null && !isTerminalTurnStatus(turn.status);
}

export function turnSnapshot(agentId: string, turn: SessionTurn): TurnSnapshot {
  return {
    agentId,
    turnId: turn.turnId,
    agentSeq: turn.agentSeq,
    createdAt: turn.createdAt,
    seq: turn.seq,
    allowShell: turn.allowShell,
    commandMode: turn.commandMode ?? 'ask',
    status: turn.status,
    pending: turn.pending,
    ...(turn.error ? { error: turn.error } : {}),
  };
}

export function agentSnapshot(
  state: SessionState,
  updatedAt: number,
  execution: AgentSnapshot['execution'] = 'ready',
  fault?: ErrorData,
): AgentSnapshot {
  const active = activeTurnOf(state);
  return {
    id: state.agentId,
    createdAt: state.createdAt,
    updatedAt,
    ...(state.title ? { title: state.title } : {}),
    seq: state.seq,
    activeTurnId: state.activeTurnId,
    queuePaused: state.queuePaused,
    workspace: state.workspace,
    instructions: state.instructions,
    inference: state.inference,
    executionRevision: state.executionRevision,
    messages: state.messages,
    queuedInputs: state.queue.map(({ inputId, requestId, input }) => ({
      inputId,
      requestId,
      input,
    })),
    pendingSteering: state.pendingSteering,
    activeTurn: active ? turnSnapshot(state.agentId, active) : null,
    execution,
    ...(fault ? { fault } : {}),
  };
}

// ─────────────────────────────────────────────
// 折叠
// ─────────────────────────────────────────────

function corrupt(message: string): never {
  throw new ArcherError('EVENT_LOG_CORRUPT', message);
}

function requireState(state: SessionState | null): SessionState {
  if (!state) corrupt('Agent 日志缺少 agent.created');
  return state;
}

function turnOf(state: SessionState, turnId: string): SessionTurn {
  const turn = state.turns.get(turnId);
  if (!turn) corrupt(`Turn 事实引用了不存在的 Turn：${turnId}`);
  return turn;
}

function touch(turn: SessionTurn, seq: number): void {
  turn.seq = seq;
}

function requireNonTerminal(turn: SessionTurn, fact: string): void {
  if (isTerminalTurnStatus(turn.status)) {
    corrupt(`Turn 已终态，不能再接收 ${fact}`);
  }
}

function finishTurn(
  state: SessionState,
  turn: SessionTurn,
  status: 'completed' | 'failed' | 'cancelled',
  data: { completedAt: number; summary?: string; stopReason?: 'done' | 'respond'; error?: ErrorData; reason?: string },
): void {
  requireNonTerminal(turn, `turn.${status}`);
  const pending = lastEffectOf(turn);
  if (pending && !pending.abandoned && !['completed', 'failed', 'cancelled'].includes(pending.status)) {
    if (status !== 'failed' || (pending.status === 'unknown' && pending.effect.type === 'CALL')) {
      corrupt('未解决的执行事实不能通过终结 Turn 绕过');
    }
  }
  turn.status = status;
  turn.completedAt = data.completedAt;
  turn.pending = null;
  if (data.summary !== undefined) turn.summary = data.summary;
  if (data.stopReason !== undefined) turn.stopReason = data.stopReason;
  if (data.error !== undefined) turn.error = data.error;
  if (status !== 'completed') state.queuePaused = true;
  state.activeTurnId = null;
}

function applyEffectTransition(turn: SessionTurn, effectId: string): SessionEffect {
  return (
    turn.effects.find((candidate) => candidate.effectId === effectId)
    ?? corrupt(`Effect 事实引用了不存在的 Effect：${effectId}`)
  );
}

/** 人工选项由已提交输入投影，重签与恢复使用同一规则。 */
function humanOptions(effect: Effect): { options?: string[] } {
  if (effect.type === 'ASK_HUMAN') return effect.options ? { options: [...effect.options] } : {};
  if (effect.type !== 'CALL' || effect.interaction !== 'human' || !effect.input || typeof effect.input !== 'object' || Array.isArray(effect.input)) return {};
  const options = (effect.input as { options?: unknown }).options;
  return Array.isArray(options) && options.every(value => typeof value === 'string') ? { options: [...options] } : {};
}

/** 计划动作与它产生的 Effect 类型必须一一对应 */
function matchesAction(action: ActionPlan, type: Effect['type']): boolean {
  switch (action.kind) {
    case 'call':
      return type === 'CALL';
    case 'ask':
      return type === 'ASK_HUMAN';
  }
}

function applyLifecycle(state: SessionState | null, fact: Extract<AgentDraft, { scope: 'agent' }>['event']): SessionState {
  if (!state) {
    if (fact.type !== 'agent.created') corrupt('Agent 日志首事实必须是 agent.created');
    const created = fact.data;
    if (!created.policyId) corrupt('创建事实缺少策略身份');
    if (created.capabilityFormat !== 'provider') corrupt('创建事实缺少 Provider 能力格式声明');
    return {
      agentId: created.id,
      seq: 0,
      createdAt: created.createdAt,
      createKey: created.createKey,
      policyId: created.policyId,
      workspace: created.workspace,
      instructions: created.instructions,
      inference: created.inference,
      executionRevision: 0,
      messages: [],
      compactions: [],
      queue: [],
      queuePaused: false,
      pendingSteering: [],
      activeTurnId: null,
      turns: new Map(),
      requests: new Map(),
      inputCount: 0,
      removed: false,
    };
  }

  switch (fact.type) {
    case 'agent.created':
      corrupt('Agent 日志包含重复的 agent.created');
      break;
    case 'input.accepted': {
      const data = fact.data;
      state.inputCount += 1;
      state.queue.push({
        inputId: data.inputId,
        requestId: data.requestId,
        input: data.input,
        allowShell: data.allowShell,
        commandMode: data.commandMode ?? 'ask',
        ...(data.inference ? { inference: data.inference } : {}),
        ...(data.limits ? { limits: data.limits } : {}),
      });
      state.requests.set(data.requestId, {
        command: data.command,
        signature: requestSignature(data.command, data.input, {
          allowShell: data.allowShell,
        commandMode: data.commandMode ?? 'ask',
          limits: data.limits,
          inference: data.inference,
        }),
        inputId: data.inputId,
      });
      break;
    }
    case 'input.consumed': {
      const index = state.queue.findIndex((item) => item.inputId === fact.data.inputId);
      if (index < 0) corrupt(`input.consumed 引用了不在队列中的输入：${fact.data.inputId}`);
      state.queue.splice(index, 1);
      for (const record of state.requests.values()) {
        if (record.inputId === fact.data.inputId) record.turnId = fact.data.turnId;
      }
      break;
    }
    case 'input.unapplied': {
      const index = state.queue.findIndex((item) => item.inputId === fact.data.inputId);
      if (index < 0) corrupt(`input.unapplied 引用了不在队列中的输入：${fact.data.inputId}`);
      state.queue.splice(index, 1);
      break;
    }
    case 'steering.accepted': {
      const data = fact.data;
      state.pendingSteering.push({
        inputId: data.inputId,
        requestId: data.requestId,
        input: data.input,
        turnId: data.turnId,
      });
      state.requests.set(data.requestId, {
        command: 'steer',
        signature: requestSignature('steer', data.input, { turnId: data.turnId }),
        inputId: data.inputId,
        turnId: data.turnId,
      });
      break;
    }
    case 'steering.consumed':
    case 'steering.unapplied': {
      const index = state.pendingSteering.findIndex(
        (item) => item.inputId === fact.data.inputId,
      );
      if (index < 0) corrupt(`steer 事实引用了不在待处理集合中的输入：${fact.data.inputId}`);
      state.pendingSteering.splice(index, 1);
      break;
    }
    case 'command.accepted': {
      const data = fact.data;
      state.requests.set(data.requestId, {
        command: data.command,
        signature: data.signature,
      });
      break;
    }
    case 'queue.paused':
      state.queuePaused = true;
      break;
    case 'queue.resumed':
      state.queuePaused = false;
      break;
    case 'queue.cleared': {
      const removed = new Set(fact.data.inputIds);
      state.queue = state.queue.filter((item) => !removed.has(item.inputId));
      break;
    }
    case 'execution.configured':
      if (fact.data.expectedRevision !== state.executionRevision || fact.data.revision !== state.executionRevision + 1) corrupt('执行配置修订不连续');
      if (fact.data.workspaceAccess) {
        if (!state.workspace) corrupt('工作环境访问变更缺少工作环境');
        state.workspace = { ...state.workspace!, access: fact.data.workspaceAccess };
      }
      state.executionRevision = fact.data.revision;
      break;
    case 'agent.renamed':
      state.title = fact.data.title;
      break;
    case 'agent.removed':
      state.removed = true;
      state.removedAt = fact.data.removedAt;
      state.activeTurnId = null;
      state.queue = [];
      state.pendingSteering = [];
      break;
    default:
      corrupt('未知的 Agent 生命周期事实');
  }
  return state;
}

function applyTurn(state: SessionState, envelope: Extract<AgentDraft, { scope: 'turn' }>, seq: number): SessionState {
  const fact = envelope.event;
  const turnId = envelope.turnId;

  if (fact.type === 'turn.created') {
    if (state.turns.has(fact.data.turnId)) corrupt(`Turn 重复创建：${fact.data.turnId}`);
    if (state.activeTurnId !== null) corrupt('同一 Agent 出现第二个活跃 Turn');
    const turn: SessionTurn = {
      turnId: fact.data.turnId,
      agentSeq: seq,
      seq: 1,
      inputId: fact.data.inputId,
      status: 'running',
      allowShell: fact.data.allowShell,
      commandMode: fact.data.commandMode ?? 'ask',
      ...(fact.data.inference ? { inference: fact.data.inference } : {}),
      limits: {
        ...(fact.data.limits?.maxInferenceSteps !== undefined
          ? { maxInferenceSteps: fact.data.limits.maxInferenceSteps }
          : {}),
        ...(fact.data.limits?.tokenBudget !== undefined
          ? { tokenBudget: fact.data.limits.tokenBudget }
          : {}),
      },
      createdAt: fact.data.createdAt,
      inferenceSteps: 0,
      plan: null,
      effects: [],
      pending: null,
      cancel: null,
    };
    state.turns.set(turn.turnId, turn);
    state.activeTurnId = turn.turnId;
    return state;
  }

  const turn = turnOf(state, turnId);
  touch(turn, seq);
  requireNonTerminal(turn, fact.type);

  switch (fact.type) {
    case 'turn.cancel.requested': {
      turn.cancel ??= { reason: fact.data.reason, requestedAt: fact.data.requestedAt };
      break;
    }
    case 'turn.authorization.changed':
      turn.allowShell = fact.data.allowShell;
      turn.commandMode = fact.data.commandMode;
      break;
    case 'turn.status':
      turn.status = fact.data.status;
      if (fact.data.status === 'waiting') {
        const effect = lastEffectOf(turn);
        if (effect?.status === 'unknown') {
          turn.pending = effect.effect.type === 'CALL'
            ? {
                kind: 'reconcile',
                effectId: effect.effectId,
                target: effect.effect.target,
                ...(effect.error ? { error: effect.error } : {}),
              }
            : null;
        } else if (effect?.status === 'suspended') {
          turn.pending = {
            kind: 'human',
        ...(effect.effect.type === 'CALL' && effect.effect.interaction !== 'human' ? { purpose: 'command' as const } : {}),
            effectId: effect.effectId,
            reason: effect.suspended?.reason ?? effect.effect.type,
            ...humanOptions(effect.effect),
          };
        }
      }
      break;
    case 'message.appended':
      state.messages.push(fact.data.message);
      break;
    case 'completion.review.requested': {
      const effect = turn.effects.find(item => item.effectId === fact.data.afterEffectId);
      if (!effect || effect.effect.type !== 'CALL' || !['completed', 'failed'].includes(effect.status) || turn.completionReviewAfter === fact.data.afterEffectId) corrupt('结束复核必须引用新的已收束操作');
      turn.completionReviewAfter = fact.data.afterEffectId;
      break;
    }
    case 'inference.started':
      turn.plan = null;
      turn.inferenceSteps = fact.data.step;
      break;
    case 'inference.planned':
      turn.plan = {
        actions: fact.data.actions,
        nextIndex: 0,
        ...(fact.data.terminal ? { terminal: fact.data.terminal } : {}),
      };
      break;
    case 'effect.created': {
      if (fact.data.effect.type === 'INFER' && !InferEffectSchema.safeParse(fact.data.effect).success) corrupt('推理意图或固定前缀计数无效');
      if (turn.cancel || hasPendingEffect(turn)) corrupt('取消或未收束操作期间不能创建 Effect');
      if (!fact.data.effectId || !fact.data.idempotencyKey) corrupt('Effect 身份不能为空');
      if (turn.effects.some((effect) => effect.effectId === fact.data.effectId)) {
        corrupt(`Effect 重复创建：${fact.data.effectId}`);
      }
      turn.effects.push({
        effectId: fact.data.effectId,
        effect: fact.data.effect,
        idempotencyKey: fact.data.idempotencyKey,
        inferenceStep: turn.inferenceSteps,
        status: 'created',
        inferenceRequests: [],
        attempt: 0,
        createdAt: fact.data.createdAt,
      });
      if (
        turn.plan
        && turn.plan.nextIndex < turn.plan.actions.length
        && matchesAction(turn.plan.actions[turn.plan.nextIndex], fact.data.effect.type)
      ) {
        turn.plan.nextIndex += 1;
      }
      break;
    }
    case 'effect.started': {
      const effect = applyEffectTransition(turn, fact.data.effectId);
      if (fact.data.effectType !== effect.effect.type) corrupt('Effect 类型与创建事实不一致');
      if (effect.status !== 'created' && effect.status !== 'resumed') {
        corrupt(`非法 Effect 开始迁移：${effect.status} → started`);
      }
      if (turn.cancel || effect.effect.type === 'ASK_HUMAN' || fact.data.attempt !== effect.attempt + 1) corrupt('Effect 开始条件或 attempt 不匹配');
      effect.status = 'started';
      effect.attempt = fact.data.attempt;
      effect.startedAt = fact.data.startedAt;
      break;
    }
    case 'inference.requested': {
      const effect = applyEffectTransition(turn, fact.data.effectId);
      if (effect.effect.type !== 'INFER' || effect.status !== 'started' || turn.cancel) corrupt('模型请求必须属于已开始且未取消的 INFER');
      if (fact.data.requestId !== `${effect.effectId}:request:${effect.inferenceRequests.length + 1}`
        || effect.inferenceRequests.some(item => item.purpose === 'agent' && item.status === 'completed' || item.status === 'requested' && item.attempt === effect.attempt)) corrupt('模型请求重复或存在未收束请求');
      if (canonicalJson(fact.data.request.target) !== canonicalJson(effect.effect.target)) corrupt('模型请求改变固定能力引用');
      const fixedConfig = effect.effect.config;
      if (fact.data.request.config?.provider !== fixedConfig?.provider || fact.data.request.config?.model !== fixedConfig?.model) corrupt('模型请求改变已固定路由或模型');
      if (fact.data.purpose === 'agent' && canonicalJson(fact.data.request.tools ?? []) !== canonicalJson(effect.effect.tools ?? [])) corrupt('普通请求改变固定工具声明');
      effect.inferenceRequests.push({ attempt: effect.attempt, requestId: fact.data.requestId, purpose: fact.data.purpose, request: fact.data.request, status: 'requested' });
      break;
    }
    case 'inference.responded':
    case 'inference.request.failed': {
      const effect = applyEffectTransition(turn, fact.data.effectId);
      const request = effect.inferenceRequests.find(item => item.requestId === fact.data.requestId);
      if (effect.status !== 'started' || !request || request.status !== 'requested' || request.attempt !== effect.attempt) corrupt('模型响应没有对应的在途请求');
      if (fact.type === 'inference.responded') {
        if (!InferResultSchema.safeParse(fact.data.result).success) corrupt('模型响应不符合结果协议');
        request.status = 'completed';
        request.result = fact.data.result;
      } else {
        request.status = 'failed';
        request.error = fact.data.error;
      }
      break;
    }
    case 'context.compacted': {
      const effect = applyEffectTransition(turn, fact.data.effectId);
      const request = effect.inferenceRequests.find(item => item.requestId === fact.data.requestId);
      if (effect.effect.type !== 'INFER' || effect.status !== 'started' || turn.cancel || !request || request.purpose !== 'compaction' || request.status !== 'completed'
        || request.result?.content !== fact.data.summary || !fact.data.summary.trim() || request.result.stopReason === 'length' || request.result.toolCalls?.length) corrupt('摘要必须来源于已确认的完整摘要响应');
      if (state.compactions.some(item => item.requestId === fact.data.requestId)) corrupt('同一摘要请求不能重复提交');
      const prior = state.compactions.at(-1);
      const previous = prior?.coveredMessageCount ?? 0;
      if (fact.data.coveredMessageCount <= previous || fact.data.coveredMessageCount > effect.effect.messages.length - effect.effect.promptPrefixCount) corrupt('摘要覆盖范围无效');
      const source = effect.effect.messages.slice(effect.effect.promptPrefixCount, effect.effect.promptPrefixCount + fact.data.coveredMessageCount);
      const pending = new Set<string>();
      for (const message of source) {
        for (const call of message.toolCalls ?? []) pending.add(call.id);
        if (message.role === 'tool') pending.delete(message.toolCallId ?? '');
      }
      if (pending.size || request.request.messages[1]?.content !== canonicalJson(JSON.parse(JSON.stringify({ previousSummary: prior?.summary, sourceStart: previous, messages: source.slice(previous) })))
        || fact.data.summary.length > 16_384 || request.result.stopReason === 'toolUse' || request.request.tools?.length || request.request.preparations?.length) corrupt('摘要输入、覆盖边界或输出无效');
      try { validateContextHandoff(fact.data.summary, source); } catch { corrupt('Invalid structured handoff or evidence'); }
      state.compactions.push({ effectId: fact.data.effectId, requestId: fact.data.requestId, coveredMessageCount: fact.data.coveredMessageCount, summary: fact.data.summary });
      break;
    }
    case 'effect.suspended': {
      const effect = applyEffectTransition(turn, fact.data.effectId);
      if (!['created', 'suspended'].includes(effect.status) || !['ASK_HUMAN', 'CALL'].includes(effect.effect.type) || turn.cancel) corrupt('只有未取消的人工请求或命令能挂起');
      effect.status = 'suspended';
      effect.suspended = {
        reason: fact.data.reason,
        resumeTokenHash: fact.data.resumeTokenHash,
        ...(fact.data.expiresAt !== undefined ? { expiresAt: fact.data.expiresAt } : {}),
      };
      turn.status = 'waiting';
      turn.pending = {
        kind: 'human',
        ...(effect.effect.type === 'CALL' && effect.effect.interaction !== 'human' ? { purpose: 'command' as const } : {}),
        effectId: effect.effectId,
        reason: fact.data.reason,
        ...humanOptions(effect.effect),
      };
      break;
    }
    case 'effect.resumed': {
      const effect = applyEffectTransition(turn, fact.data.effectId);
      if (effect.abandoned || effect.status !== 'suspended' && effect.status !== 'unknown') {
        corrupt(`非法 Effect 恢复迁移：${effect.status} → resumed`);
      }
      if (turn.cancel || fact.data.attempt !== effect.attempt
        || (effect.status === 'suspended' ? fact.data.kind !== 'human' : fact.data.kind !== 'reconcile_retry')) corrupt('恢复许可与执行事实不匹配');
      if (effect.effect.type === 'CALL' && fact.data.kind === 'human') effect.commandApproved = true;
      effect.status = 'resumed';
      turn.pending = null;
      break;
    }
    case 'effect.completed': {
      const effect = applyEffectTransition(turn, fact.data.effectId);
      if (fact.data.effectType !== effect.effect.type) corrupt('Effect 类型与完成事实不一致');
      if (effect.status !== 'started' && !(effect.status === 'resumed' && (effect.effect.type === 'ASK_HUMAN' || (effect.effect.type === 'CALL' && effect.effect.interaction === 'human')))) corrupt('操作尚未执行或人工回复未经恢复许可');
      if (!validateEffectResult(effect.effect.type, fact.data.result).ok) corrupt('Effect 完成结果不符合协议');
      if (effect.effect.type === 'INFER') {
        const confirmed = effect.inferenceRequests.find(item => item.purpose === 'agent' && item.status === 'completed');
        if (!confirmed?.result || canonicalJson(confirmed.result) !== canonicalJson(fact.data.result)) corrupt('INFER 完成必须复用已确认的普通模型响应');
      }
      effect.status = 'completed';
      effect.result = fact.data.result;
      effect.finishedAt = fact.data.finishedAt;
      effect.durationMs = fact.data.durationMs;
      break;
    }
    case 'effect.failed': {
      const effect = applyEffectTransition(turn, fact.data.effectId);
      if (['completed', 'failed', 'cancelled'].includes(effect.status) || fact.data.effectType !== effect.effect.type) corrupt('Effect 失败事实与当前操作不匹配');
      effect.status = 'failed';
      effect.error = fact.data.error;
      effect.finishedAt = fact.data.finishedAt;
      effect.durationMs = fact.data.durationMs;
      break;
    }
    case 'effect.cancelled': {
      const effect = applyEffectTransition(turn, fact.data.effectId);
      if (['completed', 'failed', 'cancelled'].includes(effect.status) || (effect.status === 'unknown' && effect.effect.type === 'CALL')) corrupt('操作不能被确认取消');
      effect.status = 'cancelled';
      effect.reason = fact.data.reason;
      effect.finishedAt = fact.data.finishedAt;
      break;
    }
    case 'effect.abandoned': {
      const effect = applyEffectTransition(turn, fact.data.effectId);
      if (effect.status !== 'unknown' || effect.effect.type !== 'CALL' || effect.abandoned) corrupt('只有未处理的未知写入能放弃追踪');
      effect.abandoned = { reason: fact.data.reason, at: fact.data.abandonedAt };
      turn.pending = null;
      break;
    }
    case 'effect.unknown': {
      const effect = applyEffectTransition(turn, fact.data.effectId);
      if (effect.status !== 'started') corrupt(`非法 Effect 未知迁移：${effect.status} → unknown`);
      effect.status = 'unknown';
      effect.unknown = { detectedAt: fact.data.detectedAt };
      if (fact.data.error) effect.error = fact.data.error;
      if (effect.effect.type === 'CALL') {
        turn.status = 'waiting';
        turn.pending = {
          kind: 'reconcile',
          effectId: effect.effectId,
          target: effect.effect.target,
          ...(effect.error ? { error: effect.error } : {}),
        };
      }
      break;
    }
    case 'turn.completed':
      finishTurn(state, turn, 'completed', {
        completedAt: fact.data.completedAt,
        stopReason: fact.data.stopReason,
        ...(fact.data.summary !== undefined ? { summary: fact.data.summary } : {}),
      });
      break;
    case 'turn.failed':
      finishTurn(state, turn, 'failed', {
        completedAt: fact.data.completedAt,
        error: fact.data.error,
      });
      break;
    case 'turn.cancelled':
      finishTurn(state, turn, 'cancelled', {
        completedAt: fact.data.completedAt,
        ...(fact.data.reason !== undefined ? { error: { code: 'ABORTED', message: fact.data.reason } } : {}),
      });
      break;
    default:
      corrupt('未知的 Turn 事实');
  }
  return state;
}

/** 折叠一条草稿；输入状态会被原地更新 */
export function foldAgentDraft(state: SessionState | null, draft: AgentDraft, seq = 0): SessionState {
  const current = draft.scope === 'agent'
    ? applyLifecycle(state, draft.event)
    : applyTurn(requireState(state), draft, seq);
  current.seq = Math.max(current.seq, seq);
  return current;
}

/** 从已提交事件重建会话；校验信封连续性与事实顺序 */
export function replayAgent(agentId: string, events: readonly AgentEvent[]): SessionState | null {
  if (events.length === 0) return null;
  let state: SessionState | null = null;
  let expectedSeq = 1;
  const turnSeq = new Map<string, number>();

  for (const event of events) {
    if (event.agentId !== agentId) corrupt('事件 agentId 与日志不一致');
    if (event.seq !== expectedSeq) corrupt('Agent 日志序号不连续');
    if (event.id !== `${agentId}:${event.seq}`) corrupt('Agent 事件 id 与序号不一致');
    expectedSeq += 1;

    if (event.fact.scope === 'turn') {
      const next = (turnSeq.get(event.fact.turnId) ?? 0) + 1;
      if (event.fact.turnSeq !== next) corrupt('Turn 日志序号不连续');
      turnSeq.set(event.fact.turnId, next);
    }

    state = foldAgentDraft(state, event.fact, event.seq);
  }
  return state;
}

// ─────────────────────────────────────────────
// 请求签名
// ─────────────────────────────────────────────

export function requestSignature(
  command: string,
  input: unknown,
  options: { commandMode?: import('@archer/contracts').CommandMode; allowShell?: boolean; limits?: TurnLimits; inference?: InferConfig; turnId?: string } = {},
): string {
  return JSON.stringify([
    command,
    normalizedJson(input),
    options.allowShell === true,
    options.commandMode ?? 'ask',
    options.limits?.maxInferenceSteps ?? null,
    options.limits?.tokenBudget ?? null,
    options.turnId ?? null,
    normalizedJson(options.inference ?? null),
  ]);
}

function normalizedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizedJson);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      result[key] = normalizedJson(record[key]);
    }
    return result;
  }
  return value;
}
