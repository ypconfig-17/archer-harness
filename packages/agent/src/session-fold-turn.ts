/**
 * Archer Harness — Turn 级事实折叠
 *
 * 负责将 Turn 生命周期、推理请求、上下文摘要及 Effect 状态迁移事实折叠到 SessionState。
 */

import type { ActionPlan, AgentDraft, Effect, ErrorData } from '@archer/contracts';
import {
  InferEffectSchema,
  InferResultSchema,
  canonicalJson,
  isTerminalTurnStatus,
  validateContextHandoff,
  validateEffectResult,
} from '@archer/contracts';
import { corrupt } from './session-fold-agent.js';
import {
  hasPendingEffect,
  lastEffectOf,
  type SessionEffect,
  type SessionState,
  type SessionTurn,
} from './session-state.js';

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
  data: {
    completedAt: number;
    summary?: string;
    stopReason?: 'done' | 'respond';
    error?: ErrorData;
    reason?: string;
  },
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
    turn.effects.find((candidate) => candidate.effectId === effectId) ??
    corrupt(`Effect 事实引用了不存在的 Effect：${effectId}`)
  );
}

/** 人工选项由已提交输入投影，重签与恢复使用同一规则。 */
function humanOptions(effect: Effect): { options?: string[] } {
  if (
    effect.type !== 'CALL' ||
    effect.interaction !== 'human' ||
    !effect.input ||
    typeof effect.input !== 'object' ||
    Array.isArray(effect.input)
  ) {
    return {};
  }
  const options = (effect.input as { options?: unknown }).options;
  return Array.isArray(options) && options.every((value) => typeof value === 'string')
    ? { options: [...options] }
    : {};
}

/** 计划动作与它产生的 Effect 类型必须一一对应 */
function matchesAction(action: ActionPlan, type: Effect['type']): boolean {
  switch (action.kind) {
    case 'call':
      return type === 'CALL';
  }
}

/** 折叠单条 Turn 作用域事实；state 会被原地更新。 */
export function applyTurn(
  state: SessionState,
  envelope: Extract<AgentDraft, { scope: 'turn' }>,
  seq: number,
): SessionState {
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
          turn.pending =
            effect.effect.type === 'CALL'
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
            ...(effect.effect.type === 'CALL' && effect.effect.interaction !== 'human'
              ? { purpose: 'command' as const }
              : {}),
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
      const effect = turn.effects.find((item) => item.effectId === fact.data.afterEffectId);
      if (
        !effect ||
        effect.effect.type !== 'CALL' ||
        !['completed', 'failed'].includes(effect.status) ||
        turn.completionReviewAfter === fact.data.afterEffectId
      ) {
        corrupt('结束复核必须引用新的已收束操作');
      }
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
      if (fact.data.effect.type === 'INFER' && !InferEffectSchema.safeParse(fact.data.effect).success) {
        corrupt('推理意图或固定前缀计数无效');
      }
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
      if (turn.plan && turn.plan.nextIndex < turn.plan.actions.length) {
        if (fact.data.effect.type === 'CALL_BATCH') {
          const count = fact.data.effect.calls.length;
          const slice = turn.plan.actions.slice(turn.plan.nextIndex, turn.plan.nextIndex + count);
          if (slice.length === count && slice.every((action) => action.kind === 'call')) {
            turn.plan.nextIndex += count;
          }
        } else if (matchesAction(turn.plan.actions[turn.plan.nextIndex], fact.data.effect.type)) {
          turn.plan.nextIndex += 1;
        }
      }
      break;
    }
    case 'effect.started': {
      const effect = applyEffectTransition(turn, fact.data.effectId);
      if (fact.data.effectType !== effect.effect.type) corrupt('Effect 类型与创建事实不一致');
      if (effect.status !== 'created' && effect.status !== 'resumed') {
        corrupt(`非法 Effect 开始迁移：${effect.status} → started`);
      }
      if (turn.cancel || fact.data.attempt !== effect.attempt + 1) {
        corrupt('Effect 开始条件或 attempt 不匹配');
      }
      effect.status = 'started';
      effect.attempt = fact.data.attempt;
      effect.startedAt = fact.data.startedAt;
      break;
    }
    case 'inference.requested': {
      const effect = applyEffectTransition(turn, fact.data.effectId);
      if (effect.effect.type !== 'INFER' || effect.status !== 'started' || turn.cancel) {
        corrupt('模型请求必须属于已开始且未取消的 INFER');
      }
      if (
        fact.data.requestId !== `${effect.effectId}:request:${effect.inferenceRequests.length + 1}` ||
        effect.inferenceRequests.some(
          (item) =>
            (item.purpose === 'agent' && item.status === 'completed') ||
            (item.status === 'requested' && item.attempt === effect.attempt),
        )
      ) {
        corrupt('模型请求重复或存在未收束请求');
      }
      if (canonicalJson(fact.data.request.target) !== canonicalJson(effect.effect.target)) {
        corrupt('模型请求改变固定能力引用');
      }
      const fixedConfig = effect.effect.config;
      if (
        fact.data.request.config?.provider !== fixedConfig?.provider ||
        fact.data.request.config?.model !== fixedConfig?.model
      ) {
        corrupt('模型请求改变已固定路由或模型');
      }
      if (
        fact.data.purpose === 'agent' &&
        canonicalJson(fact.data.request.tools ?? []) !== canonicalJson(effect.effect.tools ?? [])
      ) {
        corrupt('普通请求改变固定工具声明');
      }
      effect.inferenceRequests.push({
        attempt: effect.attempt,
        requestId: fact.data.requestId,
        purpose: fact.data.purpose,
        request: fact.data.request,
        status: 'requested',
      });
      break;
    }
    case 'inference.responded':
    case 'inference.request.failed': {
      const effect = applyEffectTransition(turn, fact.data.effectId);
      const request = effect.inferenceRequests.find((item) => item.requestId === fact.data.requestId);
      if (effect.status !== 'started' || !request || request.status !== 'requested' || request.attempt !== effect.attempt) {
        corrupt('模型响应没有对应的在途请求');
      }
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
      const request = effect.inferenceRequests.find((item) => item.requestId === fact.data.requestId);
      if (
        effect.effect.type !== 'INFER' ||
        effect.status !== 'started' ||
        turn.cancel ||
        !request ||
        request.purpose !== 'compaction' ||
        request.status !== 'completed' ||
        request.result?.content !== fact.data.summary ||
        !fact.data.summary.trim() ||
        request.result.stopReason === 'length' ||
        request.result.toolCalls?.length
      ) {
        corrupt('摘要必须来源于已确认的完整摘要响应');
      }
      if (state.compactions.some((item) => item.requestId === fact.data.requestId)) {
        corrupt('同一摘要请求不能重复提交');
      }
      const prior = state.compactions.at(-1);
      const previous = prior?.coveredMessageCount ?? 0;
      if (
        fact.data.coveredMessageCount <= previous ||
        fact.data.coveredMessageCount > effect.effect.messages.length - effect.effect.promptPrefixCount
      ) {
        corrupt('摘要覆盖范围无效');
      }
      const source = effect.effect.messages.slice(
        effect.effect.promptPrefixCount,
        effect.effect.promptPrefixCount + fact.data.coveredMessageCount,
      );
      const pending = new Set<string>();
      for (const message of source) {
        for (const call of message.toolCalls ?? []) pending.add(call.id);
        if (message.role === 'tool') pending.delete(message.toolCallId ?? '');
      }
      if (
        pending.size ||
        request.request.messages[1]?.content !==
          canonicalJson(
            JSON.parse(
              JSON.stringify({
                previousSummary: prior?.summary,
                sourceStart: previous,
                messages: source.slice(previous),
              }),
            ),
          ) ||
        fact.data.summary.length > 16_384 ||
        request.result.stopReason === 'toolUse' ||
        request.request.tools?.length ||
        request.request.preparations?.length
      ) {
        corrupt('摘要输入、覆盖边界或输出无效');
      }
      try {
        validateContextHandoff(fact.data.summary, source);
      } catch {
        corrupt('Invalid structured handoff or evidence');
      }
      state.compactions.push({
        effectId: fact.data.effectId,
        requestId: fact.data.requestId,
        coveredMessageCount: fact.data.coveredMessageCount,
        summary: fact.data.summary,
      });
      break;
    }
    case 'effect.suspended': {
      const effect = applyEffectTransition(turn, fact.data.effectId);
      if (!['created', 'suspended'].includes(effect.status) || effect.effect.type !== 'CALL' || turn.cancel) {
        corrupt('只有未取消的 CALL 操作能挂起');
      }
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
      if (effect.abandoned || (effect.status !== 'suspended' && effect.status !== 'unknown')) {
        corrupt(`非法 Effect 恢复迁移：${effect.status} → resumed`);
      }
      if (
        turn.cancel ||
        fact.data.attempt !== effect.attempt ||
        (effect.status === 'suspended' ? fact.data.kind !== 'human' : fact.data.kind !== 'reconcile_retry')
      ) {
        corrupt('恢复许可与执行事实不匹配');
      }
      if (effect.effect.type === 'CALL' && fact.data.kind === 'human') effect.commandApproved = true;
      effect.status = 'resumed';
      turn.pending = null;
      break;
    }
    case 'effect.completed': {
      const effect = applyEffectTransition(turn, fact.data.effectId);
      if (fact.data.effectType !== effect.effect.type) corrupt('Effect 类型与完成事实不一致');
      if (
        effect.status !== 'started' &&
        !(effect.status === 'resumed' && effect.effect.type === 'CALL' && effect.effect.interaction === 'human')
      ) {
        corrupt('操作尚未执行或人工回复未经恢复许可');
      }
      if (!validateEffectResult(effect.effect.type, fact.data.result).ok) corrupt('Effect 完成结果不符合协议');
      if (effect.effect.type === 'INFER' && fact.data.effectType === 'INFER') {
        const confirmed = effect.inferenceRequests.find((item) => item.purpose === 'agent' && item.status === 'completed');
        if (!confirmed?.result || canonicalJson(confirmed.result) !== canonicalJson(fact.data.result)) {
          corrupt('INFER 完成必须复用已确认的普通模型响应');
        }
      }
      effect.status = 'completed';
      effect.result = fact.data.result;
      effect.finishedAt = fact.data.finishedAt;
      effect.durationMs = fact.data.durationMs;
      break;
    }
    case 'effect.failed': {
      const effect = applyEffectTransition(turn, fact.data.effectId);
      if (['completed', 'failed', 'cancelled'].includes(effect.status) || fact.data.effectType !== effect.effect.type) {
        corrupt('Effect 失败事实与当前操作不匹配');
      }
      effect.status = 'failed';
      effect.error = fact.data.error;
      effect.finishedAt = fact.data.finishedAt;
      effect.durationMs = fact.data.durationMs;
      break;
    }
    case 'effect.cancelled': {
      const effect = applyEffectTransition(turn, fact.data.effectId);
      if (['completed', 'failed', 'cancelled'].includes(effect.status) || (effect.status === 'unknown' && effect.effect.type === 'CALL')) {
        corrupt('操作不能被确认取消');
      }
      effect.status = 'cancelled';
      effect.reason = fact.data.reason;
      effect.finishedAt = fact.data.finishedAt;
      break;
    }
    case 'effect.abandoned': {
      const effect = applyEffectTransition(turn, fact.data.effectId);
      if (effect.status !== 'unknown' || effect.effect.type !== 'CALL' || effect.abandoned) {
        corrupt('只有未处理的未知写入能放弃追踪');
      }
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
