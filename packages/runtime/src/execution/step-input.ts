/**
 * Archer Harness — Agent 创建、输入接收与队列消费决策
 *
 * 只生成草稿与命令，不直接执行 I/O 或持久化；提交成功后由 Runtime 分发。
 */

import type {
  AgentInput,
  CreateAgentOptions,
  InferConfig,
  TurnLimits,
} from '@archer/contracts';
import {
  ArcherError,
  agentInputMessage,
  cloneContextProfile,
  defaultContextProfile,
  err,
  ok,
  type Result,
} from '@archer/contracts';
import {
  DraftBuilder,
  activeTurnOf,
  applySessionPolicy,
  decisionOf,
  isTurnActive,
  lastEffectOf,
  requestSignature,
  requireTurn,
  type AcceptedInput,
  type PromptFrame,
  type SessionContext,
  type SessionDecision,
  type SessionState,
} from '@archer/agent';

export function nextInputId(state: SessionState): string {
  return `${state.agentId}:i${state.inputCount + 1}`;
}

function nextTurnId(state: SessionState): string {
  return `${state.agentId}:t${state.turns.size + 1}`;
}

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

function startTurn(
  builder: DraftBuilder,
  queued: { inputId: string; input: AgentInput },
  options: {
    commandMode?: import('@archer/contracts').CommandMode;
    allowShell: boolean;
    inference?: InferConfig;
    limits?: TurnLimits;
    promptFrame: PromptFrame;
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

  applySessionPolicy(
    builder,
    {
      kind: 'turn.started',
      turnId,
      promptFrame: options.promptFrame,
    },
    ctx,
  );
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
  accepted: Pick<
    AcceptedInput,
    'command' | 'requestId' | 'input' | 'allowShell' | 'commandMode' | 'limits' | 'inference'
  >,
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
    const started = startTurn(
      builder,
      { inputId, input: accepted.input },
      {
        allowShell: accepted.allowShell,
        commandMode: accepted.commandMode ?? 'ask',
        ...(accepted.limits ? { limits: accepted.limits } : {}),
        ...(accepted.inference ? { inference: accepted.inference } : {}),
        promptFrame,
      },
      ctx,
    );
    turnId = started.turnId;
  }

  return ok({ decision: builder.finish(), turnId });
}

/** 空闲且未暂停时消费队列中的下一条输入 */
export function canConsumeQueuedInput(state: SessionState): boolean {
  return (
    !state.removed &&
    !state.queuePaused &&
    state.queue.length > 0 &&
    !isTurnActive(activeTurnOf(state))
  );
}

export function consumeQueuedDecision(
  state: SessionState,
  promptFrame: PromptFrame,
  ctx: SessionContext,
): SessionDecision | null {
  if (!canConsumeQueuedInput(state)) return null;
  const next = state.queue[0];
  if (!next) return null;

  const builder = new DraftBuilder(state);
  startTurn(
    builder,
    next,
    {
      allowShell: next.allowShell,
      commandMode: next.commandMode ?? 'ask',
      ...(next.limits ? { limits: next.limits } : {}),
      ...(next.inference ? { inference: next.inference } : {}),
      promptFrame,
    },
    ctx,
  );
  return builder.finish();
}

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
