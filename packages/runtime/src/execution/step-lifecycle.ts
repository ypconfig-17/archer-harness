/**
 * Archer Harness — 取消、配置修订、重命名、移除与进程恢复决策
 */

import type { ConfigureExecutionInput, Workspace } from '@archer/contracts';
import { ArcherError, err, ok, type Result } from '@archer/contracts';
import {
  DraftBuilder,
  activeTurnOf,
  decisionOf,
  failTurn,
  isTurnActive,
  lastEffectOf,
  requestSignature,
  settleTurnCancellation,
  type PromptFrame,
  type SessionContext,
  type SessionDecision,
  type SessionState,
  type SessionTurn,
} from '@archer/agent';
import { humanReplyDecision } from './step-effect.js';
import { consumeQueuedDecision } from './step-input.js';

export function abortDecision(
  state: SessionState,
  options: { requestId: string; turnId?: string; reason?: string },
  ctx: SessionContext,
): Result<SessionDecision, ArcherError> {
  if (state.removed) return err(new ArcherError('NOT_FOUND', `Agent 不存在：${state.agentId}`));

  const signature = requestSignature(
    'abort',
    { reason: options.reason ?? '' },
    { ...(options.turnId !== undefined ? { turnId: options.turnId } : {}) },
  );
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
  if (!turn.cancel) {
    builder.turn(turn.turnId, {
      type: 'turn.cancel.requested',
      data: { reason, requestedAt: ctx.now },
    });
  }
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

export function configureExecutionDecision(
  state: SessionState,
  expectedRevision: number,
  workspaceAccess: Workspace['access'] | undefined,
  commandAuthorization: ConfigureExecutionInput['commandAuthorization'] | undefined,
  ctx: SessionContext,
): Result<SessionDecision, ArcherError> {
  if (state.removed) return err(new ArcherError('NOT_FOUND', `Agent 不存在：${state.agentId}`));
  const active = activeTurnOf(state);
  if (
    commandAuthorization &&
    (!active || active.turnId !== commandAuthorization.turnId || active.cancel || !isTurnActive(active))
  ) {
    return err(new ArcherError('CONFLICT', '授权目标任务已改变或正在取消'));
  }
  if (state.executionRevision !== expectedRevision) {
    return err(
      new ArcherError('CONFLICT', '执行配置修订不匹配', {
        expectedRevision,
        actualRevision: state.executionRevision,
      }),
    );
  }

  if (
    commandAuthorization?.expectedPendingEffectId !== undefined &&
    (active?.pending?.effectId ?? null) !== commandAuthorization.expectedPendingEffectId
  ) {
    return err(new ArcherError('CONFLICT', '当前等待项已改变，请重新确认完全访问'));
  }
  const approval = commandAuthorization?.approveCommand;
  if (
    approval &&
    (!commandAuthorization.allowShell ||
      commandAuthorization.commandMode !== 'full' ||
      active?.pending?.kind !== 'human' ||
      active.pending.purpose !== 'command' ||
      active.pending.effectId !== approval.effectId)
  ) {
    return err(new ArcherError('CONFLICT', '当前项不是可批准的命令授权'));
  }
  if (workspaceAccess && !state.workspace) {
    return err(new ArcherError('INVALID_ARGUMENT', 'Agent 未绑定工作环境'));
  }
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
    builder.turn(commandAuthorization.turnId, {
      type: 'turn.authorization.changed',
      data: {
        allowShell: commandAuthorization.allowShell,
        commandMode: commandAuthorization.commandMode,
      },
    });
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

export function recoverDecision(
  state: SessionState,
  promptFrame: PromptFrame,
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
    failTurn(
      builder,
      turn,
      {
        code: 'INTERNAL',
        message: '活跃 Turn 缺少 Effect 事实',
      },
      ctx,
    );
    return builder.finish();
  }

  const cancelling = turn.cancel !== null || turn.status === 'cancelling';

  if (effect.abandoned) {
    if (turn.cancel) settleTurnCancellation(builder, turn, turn.cancel.reason ?? 'aborted', ctx);
    else {
      failTurn(
        builder,
        turn,
        {
          code: 'UNKNOWN_SIDE_EFFECT',
          message: `已放弃追踪未知操作：${effect.abandoned.reason}。原操作是否生效仍未知。`,
        },
        ctx,
      );
    }
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

  failTurn(
    builder,
    turn,
    {
      code: 'INTERNAL',
      message: '恢复时发现 Turn 未完成但 Effect 已收束',
    },
    ctx,
  );
  return builder.finish();
}
