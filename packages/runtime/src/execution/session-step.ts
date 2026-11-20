/**
 * Archer Harness — Agent 会话与执行协调
 *
 * 处理输入、Effect 结果、取消与恢复；模型协议由纯 Agent 策略解释。
 * 只有草稿提交成功后才允许执行命令。
 */

import type {
  AgentInput,
  InferConfig,
  CreateAgentOptions,
  Effect,
  EffectResult,

  TurnLimits,
  TurnPayload,
} from '@archer/contracts';
import {
  ArcherError,
  cloneContextProfile,
  defaultContextProfile,
  agentInputMessage,
  ok,
  err,
  type Result,
} from '@archer/contracts';
import { type SessionState, type SessionEffect, type SessionTurn, activeTurnOf, isTurnActive, lastEffectOf, requestSignature } from '@archer/agent';
import { DraftBuilder, decisionOf, requireTurn, turnOfEffect, failTurn, type SessionContext, type SessionDecision, type SessionEffectOutcome, type AcceptedInput } from '@archer/agent';
import { settleTurnCancellation } from '@archer/agent';
import { applySessionPolicy } from '@archer/agent';

// ─────────────────────────────────────────────
// 创建 Agent
// ─────────────────────────────────────────────

export function createAgentDecision(
  state: SessionState | null,
  options: CreateAgentOptions,
  createKey: string,
  ctx: SessionContext,
): Result<SessionDecision, ArcherError> {
  if (state) {
    if (state.removed) {
      return err(new ArcherError('CONFLICT', `Agent 已被删除，不能复用 id：${state.agentId}`));
    }
    if (state.createKey !== createKey) {
      return err(new ArcherError('CONFLICT', `Agent 已存在且创建声明不同：${state.agentId}`));
    }
    return ok(decisionOf(state));
  }

  const builder = new DraftBuilder(null);
  builder.agent({
    type: 'agent.created',
    data: {
      id: options.id,
      workspace: options.workspace,
      instructions: options.instructions,
      // 默认策略也必须成为事实；排队、重启和后续 INFER 只读取已固定的快照。
      inference: {
        ...options.inference,
        contextProfile: options.inference?.contextProfile
          ? cloneContextProfile(options.inference.contextProfile)
          : defaultContextProfile(),
      },
      capabilityFormat: 'provider',
      createKey,
      createdAt: ctx.now,
      policyId: ctx.agentPolicy?.id ?? 'function-call',
    },
  });
  return ok(builder.finish());
}

// ─────────────────────────────────────────────
// 输入与 Turn
// ─────────────────────────────────────────────

function nextInputId(state: SessionState): string {
  return `${state.agentId}:i${state.inputCount + 1}`;
}

function nextTurnId(state: SessionState): string {
  return `${state.agentId}:t${state.turns.size + 1}`;
}

function startTurn(
  builder: DraftBuilder,
  queued: { inputId: string; input: AgentInput },
  options: {
    commandMode?: import('@archer/contracts').CommandMode;
    allowShell: boolean;
    inference?: InferConfig;
    limits?: TurnLimits;
    promptFrame: import('@archer/agent').PromptFrame;
  },
  ctx: SessionContext,
): { turnId: string; effectId: string } {
  if (options.promptFrame.prefix.length === 0) {
    throw new ArcherError('INTERNAL', '新建 Turn 必须提供 Prompt 前缀');
  }
  const state = builder.state;
  const turnId = nextTurnId(state);
  const userMessage = agentInputMessage(queued.input);

  builder.agent({
    type: 'input.consumed',
    data: { inputId: queued.inputId, turnId },
  });
  builder.turn(turnId, {
    type: 'turn.created',
    data: {
      turnId,
      inputId: queued.inputId,
      allowShell: options.allowShell,
      commandMode: options.commandMode ?? 'ask',
      ...(options.inference ? { inference: options.inference } : {}),
      ...(options.limits ? { limits: options.limits } : {}),
      createdAt: ctx.now,
    },
  });
  builder.turn(turnId, {
    type: 'message.appended',
    data: { message: userMessage },
  });

  applySessionPolicy(builder, {
    kind: 'turn.started',
    turnId,
    promptFrame: options.promptFrame,
  }, ctx);
  const effectId = lastEffectOf(requireTurn(builder.state, turnId))?.effectId;
  if (!effectId) throw new ArcherError('INTERNAL', 'Agent 策略没有创建初始 Effect');
  return { turnId, effectId };
}

export interface InputAcceptancePreview {
  kind: 'new' | 'duplicate';
  startsTurn: boolean;
  turnId: string | null;
}

/**
 * 只读预检：与 acceptInputDecision 使用同一组 requestId 与队列规则。
 * Runtime 在编译 Prompt 之前调用，冲突时不产生额外 I/O。
 */
export function previewInputAcceptance(
  state: SessionState,
  accepted: Pick<AcceptedInput, 'command' | 'requestId' | 'input' | 'allowShell' | 'commandMode' | 'limits' | 'inference'>,
): Result<InputAcceptancePreview, ArcherError> {
  if (state.removed) return err(new ArcherError('NOT_FOUND', `Agent 不存在：${state.agentId}`));

  const signature = requestSignature(accepted.command, accepted.input, {
    allowShell: accepted.allowShell,
      commandMode: accepted.commandMode ?? 'ask',
    limits: accepted.limits,
    inference: accepted.inference,
  });
  const existing = state.requests.get(accepted.requestId);
  if (existing) {
    if (existing.signature !== signature || existing.command !== accepted.command) {
      return err(new ArcherError('CONFLICT', `requestId 已用于不同命令：${accepted.requestId}`));
    }
    return ok({ kind: 'duplicate', startsTurn: false, turnId: existing.turnId ?? null });
  }

  if (accepted.command !== 'followUp') {
    if (isTurnActive(activeTurnOf(state))) {
      return err(new ArcherError('CONFLICT', 'Agent 已有活跃 Turn'));
    }
    if (state.queue.length > 0) {
      return err(new ArcherError('CONFLICT', 'Agent 队列中仍有待处理输入'));
    }
    if (state.queuePaused) {
      return err(new ArcherError('CONFLICT', 'Agent 队列已暂停'));
    }
  }

  return ok({
    kind: 'new',
    startsTurn: !isTurnActive(activeTurnOf(state)) && !state.queuePaused,
    turnId: null,
  });
}

export function acceptInputDecision(
  state: SessionState,
  accepted: AcceptedInput,
  ctx: SessionContext,
): Result<{ decision: SessionDecision; turnId: string | null }, ArcherError> {
  const preview = previewInputAcceptance(state, accepted);
  if (!preview.ok) return preview;
  if (preview.value.kind === 'duplicate') {
    return ok({ decision: decisionOf(state), turnId: preview.value.turnId });
  }

  const builder = new DraftBuilder(state);
  const inputId = nextInputId(state);
  builder.agent({
    type: 'input.accepted',
    data: {
      inputId,
      requestId: accepted.requestId,
      command: accepted.command,
      input: accepted.input,
      allowShell: accepted.allowShell,
      commandMode: accepted.commandMode ?? 'ask',
      ...(accepted.limits ? { limits: accepted.limits } : {}),
      ...(accepted.inference ? { inference: accepted.inference } : {}),
      receivedAt: ctx.now,
    },
  });

  let turnId: string | null = null;
  if (preview.value.startsTurn) {
    const promptFrame = accepted.promptFrame;
    if (!promptFrame) {
      return err(new ArcherError('INTERNAL', '新建 Turn 必须提供 Prompt 前缀'));
    }
    const started = startTurn(builder, { inputId, input: accepted.input }, {
      allowShell: accepted.allowShell,
      commandMode: accepted.commandMode ?? 'ask',
      ...(accepted.limits ? { limits: accepted.limits } : {}),
      ...(accepted.inference ? { inference: accepted.inference } : {}),
      promptFrame,
    }, ctx);
    turnId = started.turnId;
  }

  return ok({ decision: builder.finish(), turnId });
}

/** 空闲且未暂停时消费队列中的下一条输入 */
export function canConsumeQueuedInput(state: SessionState): boolean {
  return !state.removed
    && !state.queuePaused
    && state.queue.length > 0
    && !isTurnActive(activeTurnOf(state));
}

export function consumeQueuedDecision(
  state: SessionState,
  promptFrame: import('@archer/agent').PromptFrame,
  ctx: SessionContext,
): SessionDecision | null {
  if (!canConsumeQueuedInput(state)) return null;
  const next = state.queue[0];
  if (!next) return null;

  const builder = new DraftBuilder(state);
  startTurn(builder, next, {
    allowShell: next.allowShell,
    commandMode: next.commandMode ?? 'ask',
    ...(next.limits ? { limits: next.limits } : {}),
    ...(next.inference ? { inference: next.inference } : {}),
    promptFrame,
  }, ctx);
  return builder.finish();
}

// ─────────────────────────────────────────────
// 执行开始
// ─────────────────────────────────────────────

export function beginEffectDecision(
  state: SessionState,
  effectId: string,
  ctx: SessionContext,
): Result<SessionDecision, ArcherError> {
  const turn = turnOfEffect(state, effectId);
  if (turn.turnId !== state.activeTurnId) {
    return err(new ArcherError('CONFLICT', 'Effect 不属于活跃 Turn'));
  }
  const effect = turn.effects.find((candidate) => candidate.effectId === effectId);
  if (!effect) return err(new ArcherError('NOT_FOUND', `Effect 不存在：${effectId}`));
  if (effect.status !== 'created' && effect.status !== 'resumed') {
    return err(new ArcherError('CONFLICT', `Effect 当前不能开始：${effect.status}`));
  }

  if (turn.cancel || turn.status === 'cancelling') return err(new ArcherError('CONFLICT', 'Turn 已请求取消'));
  const builder = new DraftBuilder(state);
  builder.turn(turn.turnId, { type: 'effect.started', data: {
    effectId, effectType: effect.effect.type, attempt: effect.attempt + 1, startedAt: ctx.now,
  } });
  return ok(builder.finish());
}

export function suspendEffectDecision(
  state: SessionState,
  effectId: string,
  resumeTokenHash: string,
  expiresAt: number,
  ctx: SessionContext,
): Result<SessionDecision, ArcherError> {
  const turn = turnOfEffect(state, effectId);
  const effect = turn.effects.find((candidate) => candidate.effectId === effectId);
  if (!effect) return err(new ArcherError('NOT_FOUND', `Effect 不存在：${effectId}`));
  if (!['created', 'suspended'].includes(effect.status) || !['ASK_HUMAN', 'CALL'].includes(effect.effect.type) || turn.turnId !== state.activeTurnId || turn.cancel) {
    return err(new ArcherError('CONFLICT', `Effect 当前不能挂起：${effect.status}`));
  }

  const builder = new DraftBuilder(state);
  builder.turn(turn.turnId, {
    type: 'effect.suspended',
    data: {
      effectId,
      reason: effect.effect.type === 'ASK_HUMAN' ? effect.effect.reason : effect.effect.type === 'CALL' && effect.effect.interaction === 'human' ? String((effect.effect.input as { reason: string }).reason) : `运行命令：\n${effect.effect.type === 'CALL' ? JSON.stringify(effect.effect.input, null, 2) : ''}`,
      resumeTokenHash,
      expiresAt,
      suspendedAt: ctx.now,
    },
  });
  return ok(builder.finish());
}

// ─────────────────────────────────────────────
// Effect 结果
// ─────────────────────────────────────────────

/** 将真实执行结果与 Agent 后续决定组合为同一提交批次 */

function completedData(
  effect: SessionEffect,
  result: EffectResult<Effect>,
  durationMs: number,
  now: number,
): TurnPayload<'effect.completed'> {
  return {
    effectId: effect.effectId,
    effectType: effect.effect.type,
    result,
    durationMs,
    finishedAt: now,
  } as TurnPayload<'effect.completed'>;
}

export function effectOutcomeDecision(
  state: SessionState,
  effectId: string,
  outcome: SessionEffectOutcome,
  ctx: SessionContext,
): Result<SessionDecision, ArcherError> {
  const turn = turnOfEffect(state, effectId);
  const effect = turn.effects.find((candidate) => candidate.effectId === effectId);
  if (!effect) return err(new ArcherError('NOT_FOUND', `Effect 不存在：${effectId}`));
  if (effect.status !== 'started' && effect.status !== 'resumed') {
    return err(new ArcherError('CONFLICT', `Effect 已有结果：${effect.status}`));
  }

  const builder = new DraftBuilder(state);
  const cancelling = turn.cancel !== null || turn.status === 'cancelling';

  if (outcome.status === 'completed') {
    builder.turn(turn.turnId, {
      type: 'effect.completed',
      data: completedData(effect, outcome.result, outcome.durationMs, ctx.now),
    });

    if (cancelling) {
      settleTurnCancellation(builder, turn, turn.cancel?.reason ?? 'aborted', ctx);
      return ok(builder.finish());
    }

    applySessionPolicy(builder, { kind: 'effect.settled', turnId: turn.turnId, effectId, outcome }, ctx);
    return ok(builder.finish());
  }

  if (outcome.status === 'failed') {
    builder.turn(turn.turnId, {
      type: 'effect.failed',
      data: {
        effectId,
        effectType: effect.effect.type,
        error: outcome.error,
        ...(outcome.durationMs !== undefined ? { durationMs: outcome.durationMs } : {}),
        finishedAt: ctx.now,
      },
    });
    if (cancelling) {
      settleTurnCancellation(builder, turn, turn.cancel?.reason ?? 'aborted', ctx);
      return ok(builder.finish());
    }
    applySessionPolicy(builder, { kind: 'effect.settled', turnId: turn.turnId, effectId, outcome }, ctx);
    return ok(builder.finish());
  }

  if (outcome.status === 'cancelled') {
    builder.turn(turn.turnId, {
      type: 'effect.cancelled',
      data: { effectId, reason: outcome.reason, finishedAt: ctx.now },
    });
    if (cancelling) {
      settleTurnCancellation(builder, turn, turn.cancel?.reason ?? outcome.reason, ctx);
      return ok(builder.finish());
    }
    applySessionPolicy(builder, { kind: 'effect.settled', turnId: turn.turnId, effectId, outcome }, ctx);
    return ok(builder.finish());
  }

  builder.turn(turn.turnId, {
    type: 'effect.unknown',
    data: { effectId, lastKnownStatus: 'started', detectedAt: ctx.now, error: outcome.error },
  });

  if (effect.effect.type === 'CALL') {
    if (!cancelling) {
      builder.turn(turn.turnId, {
        type: 'turn.status',
        data: { status: 'waiting', reason: '写入结果未知，等待对账' },
      });
    } else {
      builder.turn(turn.turnId, {
        type: 'turn.status',
        data: { status: 'waiting', reason: '取消期间写入结果未知' },
      });
    }
    return ok(builder.finish());
  }

  if (cancelling) {
    builder.turn(turn.turnId, {
      type: 'effect.failed',
      data: {
        effectId,
        effectType: effect.effect.type,
        error: { code: 'ABORTED', message: outcome.error.message },
        finishedAt: ctx.now,
      },
    });
    settleTurnCancellation(builder, turn, turn.cancel?.reason ?? 'aborted', ctx);
    return ok(builder.finish());
  }

  if (effect.attempt >= 2) {
    failTurn(
      builder,
      turn,
      { code: 'TURN_FAILED', message: `Effect 结果连续未知：${outcome.error.message}` },
      ctx,
    );
    return ok(builder.finish());
  }

  builder.turn(turn.turnId, {
    type: 'effect.resumed',
    data: {
      effectId,
      attempt: effect.attempt,
      kind: 'reconcile_retry',
      resumedAt: ctx.now,
    },
  });
  builder.commands.push({ type: 'dispatch_effect', effectId });
  return ok(builder.finish());
}

// ─────────────────────────────────────────────
// 取消
// ─────────────────────────────────────────────

export function abortDecision(
  state: SessionState,
  options: { requestId: string; turnId?: string; reason?: string },
  ctx: SessionContext,
): Result<SessionDecision, ArcherError> {
  if (state.removed) return err(new ArcherError('NOT_FOUND', `Agent 不存在：${state.agentId}`));

  const signature = requestSignature('abort', { reason: options.reason ?? '' }, {
    ...(options.turnId !== undefined ? { turnId: options.turnId } : {}),
  });
  const existing = state.requests.get(options.requestId);
  if (existing) {
    if (existing.signature !== signature || existing.command !== 'abort') {
      return err(new ArcherError('CONFLICT', `requestId 已用于不同命令：${options.requestId}`));
    }
    return ok(decisionOf(state));
  }

  const active = activeTurnOf(state);
  if (active && options.turnId !== undefined && options.turnId !== active.turnId) {
    return err(new ArcherError('CONFLICT', `Turn 与当前活跃 Turn 不匹配：${options.turnId}`));
  }

  const builder = new DraftBuilder(state);
  builder.agent({
    type: 'command.accepted',
    data: {
      requestId: options.requestId,
      command: 'abort',
      signature,
    },
  });

  const turn = activeTurnOf(builder.state);
  if (!turn) {
    if (!builder.state.queuePaused) {
      builder.agent({ type: 'queue.paused', data: { reason: 'abort' } });
    }
    return ok(builder.finish());
  }

  if (!builder.state.queuePaused) {
    builder.agent({ type: 'queue.paused', data: { reason: 'abort' } });
  }

  const reason = turn.cancel?.reason ?? options.reason ?? 'aborted';
  if (!turn.cancel) builder.turn(turn.turnId, {
    type: 'turn.cancel.requested', data: { reason, requestedAt: ctx.now },
  });
  const last = lastEffectOf(turn);

  if (turn.status !== 'cancelling') {
    builder.turn(turn.turnId, {
      type: 'turn.status',
      data: { status: 'cancelling', reason },
    });
  }

  if (!last) {
    settleTurnCancellation(builder, turn, reason, ctx);
    return ok(builder.finish());
  }

  if (last.status === 'started') {
    builder.commands.push({ type: 'abort_effect', effectId: last.effectId, reason });
    return ok(builder.finish());
  }

  if (last.status === 'unknown') {
    builder.turn(turn.turnId, {
      type: 'turn.status',
      data: { status: 'waiting', reason },
    });
    return ok(builder.finish());
  }

  if (last.status === 'created' || last.status === 'resumed' || last.status === 'suspended') {
    builder.turn(turn.turnId, {
      type: 'effect.cancelled',
      data: { effectId: last.effectId, reason, finishedAt: ctx.now },
    });
    settleTurnCancellation(builder, turn, reason, ctx);
    return ok(builder.finish());
  }

  settleTurnCancellation(builder, turn, reason, ctx);
  return ok(builder.finish());
}

// ─────────────────────────────────────────────
// Steer、队列与视图
// ─────────────────────────────────────────────

export function steerDecision(
  state: SessionState,
  input: AgentInput,
  options: { requestId: string; turnId?: string },
  ctx: SessionContext,
): Result<SessionDecision, ArcherError> {
  if (state.removed) return err(new ArcherError('NOT_FOUND', `Agent 不存在：${state.agentId}`));
  const signature = requestSignature('steer', input, {
    ...(options.turnId !== undefined ? { turnId: options.turnId } : {}),
  });
  const existing = state.requests.get(options.requestId);
  if (existing) {
    if (existing.signature !== signature || existing.command !== 'steer') {
      return err(new ArcherError('CONFLICT', `requestId 已用于不同命令：${options.requestId}`));
    }
    return ok(decisionOf(state));
  }

  const turn = activeTurnOf(state);
  if (!turn || turn.status === 'cancelling') {
    return err(new ArcherError('CONFLICT', '没有可接收补充输入的活跃 Turn'));
  }
  if (options.turnId !== undefined && options.turnId !== turn.turnId) {
    return err(new ArcherError('CONFLICT', `Turn 与当前活跃 Turn 不匹配：${options.turnId}`));
  }

  const builder = new DraftBuilder(state);
  builder.agent({
    type: 'steering.accepted',
    data: {
      inputId: nextInputId(state),
      requestId: options.requestId,
      input,
      turnId: turn.turnId,
      receivedAt: ctx.now,
    },
  });
  return ok(builder.finish());
}

export function resumeQueueDecision(
  state: SessionState,
  requestId: string,
  _ctx: SessionContext,
): Result<SessionDecision, ArcherError> {
  if (state.removed) return err(new ArcherError('NOT_FOUND', `Agent 不存在：${state.agentId}`));
  const signature = requestSignature('resumeQueue', {}, {});
  const existing = state.requests.get(requestId);
  if (existing) {
    if (existing.signature !== signature || existing.command !== 'resumeQueue') {
      return err(new ArcherError('CONFLICT', `requestId 已用于不同命令：${requestId}`));
    }
    return ok(decisionOf(state));
  }

  const builder = new DraftBuilder(state);
  builder.agent({
    type: 'command.accepted',
    data: { requestId, command: 'resumeQueue', signature },
  });
  if (state.queuePaused) builder.agent({ type: 'queue.resumed', data: {} });
  return ok(builder.finish());
}

export function clearQueueDecision(
  state: SessionState,
  requestId: string,
): Result<SessionDecision, ArcherError> {
  if (state.removed) return err(new ArcherError('NOT_FOUND', `Agent 不存在：${state.agentId}`));
  const signature = requestSignature('clearQueue', {}, {});
  const existing = state.requests.get(requestId);
  if (existing) {
    if (existing.signature !== signature || existing.command !== 'clearQueue') {
      return err(new ArcherError('CONFLICT', `requestId 已用于不同命令：${requestId}`));
    }
    return ok(decisionOf(state));
  }

  const builder = new DraftBuilder(state);
  builder.agent({
    type: 'command.accepted',
    data: { requestId, command: 'clearQueue', signature },
  });
  builder.agent({
    type: 'queue.cleared',
    data: { inputIds: state.queue.map((item) => item.inputId) },
  });
  return ok(builder.finish());
}

export function configureExecutionDecision(
  state: SessionState,
  expectedRevision: number,
  workspaceAccess: import('@archer/contracts').Workspace['access'] | undefined,
  commandAuthorization: import('@archer/contracts').ConfigureExecutionInput['commandAuthorization'] | undefined,
  ctx: SessionContext,
): Result<SessionDecision, ArcherError> {
  if (state.removed) return err(new ArcherError('NOT_FOUND', `Agent 不存在：${state.agentId}`));
  const active = activeTurnOf(state);
  if (commandAuthorization && (!active || active.turnId !== commandAuthorization.turnId || active.cancel || !isTurnActive(active))) {
    return err(new ArcherError('CONFLICT', '授权目标任务已改变或正在取消'));
  }
  if (state.executionRevision !== expectedRevision) {
    return err(new ArcherError('CONFLICT', '执行配置修订不匹配', {
      expectedRevision,
      actualRevision: state.executionRevision,
    }));
  }

  if (commandAuthorization?.expectedPendingEffectId !== undefined
    && (active?.pending?.effectId ?? null) !== commandAuthorization.expectedPendingEffectId) {
    return err(new ArcherError('CONFLICT', '当前等待项已改变，请重新确认完全访问'));
  }
  const approval = commandAuthorization?.approveCommand;
  if (approval && (!commandAuthorization.allowShell || commandAuthorization.commandMode !== 'full'
    || active?.pending?.kind !== 'human' || active.pending.purpose !== 'command'
    || active.pending.effectId !== approval.effectId)) {
    return err(new ArcherError('CONFLICT', '当前项不是可批准的命令授权'));
  }
  if (workspaceAccess && !state.workspace) return err(new ArcherError('INVALID_ARGUMENT', 'Agent 未绑定工作环境'));
  const builder = new DraftBuilder(state);
  builder.agent({
    type: 'execution.configured',
    data: {
      expectedRevision,
      ...(workspaceAccess ? { workspaceAccess } : {}),
      revision: expectedRevision + 1,
    },
  });
  if (commandAuthorization) {
    builder.turn(commandAuthorization.turnId, { type: 'turn.authorization.changed', data: { allowShell: commandAuthorization.allowShell, commandMode: commandAuthorization.commandMode } });
  }
  if (approval) {
    // 模式变更与当前命令的恢复许可一起提交；复用已有人工回复决策，不提前调用能力。
    const reply = humanReplyDecision(builder.state, approval.effectId, true, '', ctx);
    if (!reply.ok) return reply;
    for (const draft of reply.value.drafts) builder.add(draft);
    builder.commands.push(...reply.value.commands);
  }
  return ok(builder.finish());
}

export function renameDecision(
  state: SessionState,
  title: string,
  ctx: SessionContext,
): Result<SessionDecision, ArcherError> {
  if (state.removed) return err(new ArcherError('NOT_FOUND', `Agent 不存在：${state.agentId}`));
  const normalized = title.trim();
  if (!normalized || normalized.length > 200) {
    return err(new ArcherError('INVALID_ARGUMENT', '会话标题必须为 1 到 200 个字符'));
  }
  const builder = new DraftBuilder(state);
  builder.agent({
    type: 'agent.renamed',
    data: { title: normalized, renamedAt: ctx.now },
  });
  return ok(builder.finish());
}

export function removeDecision(
  state: SessionState,
  ctx: SessionContext,
): Result<SessionDecision, ArcherError> {
  if (state.removed) return err(new ArcherError('NOT_FOUND', `Agent 不存在：${state.agentId}`));
  const turn = activeTurnOf(state);
  // 等待人工确认或结果对账的 Turn 没有可执行 Effect，删除只提交 agent.removed，
  // 不补写 Turn 收束或重试未知操作；执行中、取消中以及仍待派发的 Turn 继续拒绝，
  // 避免把可能在途的副作用丢弃成确定结果。
  if (turn && !isStalledTurn(turn)) {
    return err(new ArcherError('CONFLICT', '存在执行中的 Turn 时不能删除 Agent'));
  }
  if (state.queue.length > 0) {
    return err(new ArcherError('CONFLICT', '队列中仍有待处理输入'));
  }

  const builder = new DraftBuilder(state);
  builder.agent({
    type: 'agent.removed',
    data: { removedAt: ctx.now },
  });
  return ok(builder.finish());
}

/** 只有等待人工输入或未知结果对账的 Turn 处于停滞状态，其余状态都可能在推进执行。 */
function isStalledTurn(turn: SessionTurn): boolean {
  if (turn.status !== 'waiting') return false;
  const effect = lastEffectOf(turn);
  return effect?.status === 'suspended' || effect?.status === 'unknown';
}

// ─────────────────────────────────────────────
// 恢复
// ─────────────────────────────────────────────

export function recoverDecision(
  state: SessionState,
  promptFrame: import('@archer/agent').PromptFrame,
  ctx: SessionContext,
): SessionDecision {
  const builder = new DraftBuilder(state);
  if (state.removed) return builder.finish();

  const turn = activeTurnOf(state);
  if (!turn) {
    return consumeQueuedDecision(state, promptFrame, ctx) ?? builder.finish();
  }

  const effect = lastEffectOf(turn);
  if (!effect) {
    failTurn(builder, turn, {
      code: 'INTERNAL',
      message: '活跃 Turn 缺少 Effect 事实',
    }, ctx);
    return builder.finish();
  }

  const cancelling = turn.cancel !== null || turn.status === 'cancelling';

  if (effect.abandoned) {
    if (turn.cancel) settleTurnCancellation(builder, turn, turn.cancel.reason ?? 'aborted', ctx);
    else failTurn(builder, turn, { code: 'UNKNOWN_SIDE_EFFECT', message: `已放弃追踪未知操作：${effect.abandoned.reason}。原操作是否生效仍未知。` }, ctx);
    return builder.finish();
  }

  if (effect.status === 'created' || effect.status === 'resumed') {
    builder.commands.push({ type: 'dispatch_effect', effectId: effect.effectId });
    return builder.finish();
  }

  if (effect.status === 'started') {
    builder.turn(turn.turnId, {
      type: 'effect.unknown',
      data: {
        effectId: effect.effectId,
        lastKnownStatus: 'started',
        detectedAt: ctx.now,
      },
    });
    if (effect.effect.type === 'CALL') {
      builder.turn(turn.turnId, {
        type: 'turn.status',
        data: {
          status: 'waiting',
          reason: '进程恢复时写入结果未知',
        },
      });
      return builder.finish();
    }
    if (cancelling) {
      builder.turn(turn.turnId, {
        type: 'effect.failed',
        data: {
          effectId: effect.effectId,
          effectType: effect.effect.type,
          error: { code: 'ABORTED', message: '恢复时按取消意图收束' },
          finishedAt: ctx.now,
        },
      });
      settleTurnCancellation(builder, turn, turn.cancel?.reason ?? 'aborted', ctx);
      return builder.finish();
    }
    builder.turn(turn.turnId, {
      type: 'effect.resumed',
      data: {
        effectId: effect.effectId,
        attempt: effect.attempt,
        kind: 'reconcile_retry',
        resumedAt: ctx.now,
      },
    });
    builder.commands.push({ type: 'dispatch_effect', effectId: effect.effectId });
    return builder.finish();
  }

  if (effect.status === 'suspended' || effect.status === 'unknown') {
    if (turn.status !== 'waiting') {
      builder.turn(turn.turnId, {
        type: 'turn.status',
        data: {
          status: 'waiting',
          reason: effect.status === 'unknown' ? '写入结果未知' : '等待人工输入',
        },
      });
    }
    return builder.finish();
  }

  failTurn(builder, turn, {
    code: 'INTERNAL',
    message: '恢复时发现 Turn 未完成但 Effect 已收束',
  }, ctx);
  return builder.finish();
}

// ─────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────

/** 人工命令只消费当前待处理项，旧 Turn、旧凭证与重复回复不能推进会话。 */
export function humanReplyDecision(state: SessionState, effectId: string, approved: boolean, response: string, ctx: SessionContext): Result<SessionDecision, ArcherError> {
  const turn = activeTurnOf(state);
  const effect = turn && lastEffectOf(turn);
  if (!turn || !effect || effect.effectId !== effectId || !['ASK_HUMAN', 'CALL'].includes(effect.effect.type) || effect.status !== 'suspended' || turn.cancel) return err(new ArcherError('CONFLICT', '人工等待项已经改变'));
  const builder = new DraftBuilder(state);
  if (effect.effect.type === 'CALL' && effect.effect.interaction !== 'human') {
    if (!approved) {
      builder.turn(turn.turnId, { type: 'effect.cancelled', data: { effectId, reason: '用户拒绝执行命令', finishedAt: ctx.now } });
      failTurn(builder, requireTurn(builder.state, turn.turnId), { code: 'PERMISSION_DENIED', message: '用户拒绝执行命令，剩余计划未执行。' }, ctx);
    } else {
      builder.turn(turn.turnId, { type: 'effect.resumed', data: { effectId, attempt: effect.attempt, kind: 'human', resumedAt: ctx.now } });
      builder.turn(turn.turnId, { type: 'turn.status', data: { status: 'running' } });
      builder.commands.push({ type: 'dispatch_effect', effectId });
    }
    return ok(builder.finish());
  }
  builder.turn(turn.turnId, { type: 'effect.resumed', data: { effectId, attempt: effect.attempt, kind: 'human', resumedAt: ctx.now } });
  const outcome: SessionEffectOutcome = { status: 'completed', result: effect.effect.type === 'CALL' ? { value: { approved, response } } : { approved, response }, durationMs: Math.max(0, ctx.now - effect.createdAt) };
  const result = effectOutcomeDecision(builder.state, effectId, outcome, ctx);
  if (!result.ok) return result;
  for (const draft of result.value.drafts) builder.add(draft);
  builder.commands.push(...result.value.commands);
  return ok(builder.finish());
}

/** retry 只授予原 Effect 新的执行许可；abandon 保留 unknown 并终结任务。 */
export function reconcileDecision(state: SessionState, effectId: string, decision: { kind: 'retry' } | { kind: 'abandon'; reason: string }, ctx: SessionContext): Result<SessionDecision, ArcherError> {
  const turn = activeTurnOf(state);
  const effect = turn && lastEffectOf(turn);
  if (!turn || !effect || effect.effectId !== effectId || effect.effect.type !== 'CALL' || effect.status !== 'unknown' || effect.abandoned) return err(new ArcherError('CONFLICT', '结果对账项已经改变'));
  const builder = new DraftBuilder(state);
  if (decision.kind === 'retry') {
    if (turn.cancel) return err(new ArcherError('CONFLICT', '已请求取消，不能重试未知操作'));
    builder.turn(turn.turnId, { type: 'effect.resumed', data: { effectId, attempt: effect.attempt, kind: 'reconcile_retry', resumedAt: ctx.now } });
    builder.commands.push({ type: 'dispatch_effect', effectId });
  } else {
    builder.turn(turn.turnId, { type: 'effect.abandoned', data: { effectId, reason: decision.reason, abandonedAt: ctx.now } });
    if (turn.cancel) settleTurnCancellation(builder, turn, turn.cancel.reason ?? 'aborted', ctx);
    else failTurn(builder, turn, { code: 'UNKNOWN_SIDE_EFFECT', message: `已放弃追踪未知操作：${decision.reason}。原操作是否生效仍未知。` }, ctx);
  }
  return ok(builder.finish());
}
