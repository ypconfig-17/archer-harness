/**
 * Archer Harness — Effect 开始、挂起、结算与人工/对账决策
 *
 * 维护单 Turn 内在途 Effect 的状态流转，确保未知写入进入对账而非自动重试。
 */

import type { Effect, EffectResult, TurnPayload } from '@archer/contracts';
import { ArcherError, err, ok, type Result } from '@archer/contracts';
import {
  DraftBuilder,
  activeTurnOf,
  applySessionPolicy,
  failTurn,
  lastEffectOf,
  requireTurn,
  settleTurnCancellation,
  turnOfEffect,
  type SessionContext,
  type SessionDecision,
  type SessionEffect,
  type SessionEffectOutcome,
  type SessionState,
} from '@archer/agent';

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

  if (turn.cancel || turn.status === 'cancelling') {
    return err(new ArcherError('CONFLICT', 'Turn 已请求取消'));
  }
  const builder = new DraftBuilder(state);
  builder.turn(turn.turnId, {
    type: 'effect.started',
    data: {
      effectId,
      effectType: effect.effect.type,
      attempt: effect.attempt + 1,
      startedAt: ctx.now,
    },
  });
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
  if (
    !['created', 'suspended'].includes(effect.status) ||
    effect.effect.type !== 'CALL' ||
    turn.turnId !== state.activeTurnId ||
    turn.cancel
  ) {
    return err(new ArcherError('CONFLICT', `Effect 当前不能挂起：${effect.status}`));
  }

  const builder = new DraftBuilder(state);
  builder.turn(turn.turnId, {
    type: 'effect.suspended',
    data: {
      effectId,
      reason:
        effect.effect.interaction === 'human'
          ? String((effect.effect.input as { reason: string }).reason)
          : `运行命令：\n${JSON.stringify(effect.effect.input, null, 2)}`,
      resumeTokenHash,
      expiresAt,
      suspendedAt: ctx.now,
    },
  });
  return ok(builder.finish());
}

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

/** 将真实执行结果与 Agent 后续决定组合为同一提交批次 */
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

    applySessionPolicy(
      builder,
      { kind: 'effect.settled', turnId: turn.turnId, effectId, outcome },
      ctx,
    );
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
    applySessionPolicy(
      builder,
      { kind: 'effect.settled', turnId: turn.turnId, effectId, outcome },
      ctx,
    );
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
    applySessionPolicy(
      builder,
      { kind: 'effect.settled', turnId: turn.turnId, effectId, outcome },
      ctx,
    );
    return ok(builder.finish());
  }

  builder.turn(turn.turnId, {
    type: 'effect.unknown',
    data: { effectId, lastKnownStatus: 'started', detectedAt: ctx.now, error: outcome.error },
  });

  if (effect.effect.type === 'CALL') {
    builder.turn(turn.turnId, {
      type: 'turn.status',
      data: {
        status: 'waiting',
        reason: cancelling ? '取消期间写入结果未知' : '写入结果未知，等待对账',
      },
    });
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

/** 人工命令只消费当前待处理项，旧 Turn、旧凭证与重复回复不能推进会话。 */
export function humanReplyDecision(
  state: SessionState,
  effectId: string,
  approved: boolean,
  response: string,
  ctx: SessionContext,
): Result<SessionDecision, ArcherError> {
  const turn = activeTurnOf(state);
  const effect = turn && lastEffectOf(turn);
  if (
    !turn ||
    !effect ||
    effect.effectId !== effectId ||
    effect.effect.type !== 'CALL' ||
    effect.status !== 'suspended' ||
    turn.cancel
  ) {
    return err(new ArcherError('CONFLICT', '人工等待项已经改变'));
  }
  const builder = new DraftBuilder(state);
  if (effect.effect.interaction !== 'human') {
    if (!approved) {
      builder.turn(turn.turnId, {
        type: 'effect.cancelled',
        data: { effectId, reason: '用户拒绝执行命令', finishedAt: ctx.now },
      });
      failTurn(
        builder,
        requireTurn(builder.state, turn.turnId),
        { code: 'PERMISSION_DENIED', message: '用户拒绝执行命令，剩余计划未执行。' },
        ctx,
      );
    } else {
      builder.turn(turn.turnId, {
        type: 'effect.resumed',
        data: { effectId, attempt: effect.attempt, kind: 'human', resumedAt: ctx.now },
      });
      builder.turn(turn.turnId, { type: 'turn.status', data: { status: 'running' } });
      builder.commands.push({ type: 'dispatch_effect', effectId });
    }
    return ok(builder.finish());
  }
  builder.turn(turn.turnId, {
    type: 'effect.resumed',
    data: { effectId, attempt: effect.attempt, kind: 'human', resumedAt: ctx.now },
  });
  const outcome: SessionEffectOutcome = {
    status: 'completed',
    result: { value: { approved, response } },
    durationMs: Math.max(0, ctx.now - effect.createdAt),
  };
  const result = effectOutcomeDecision(builder.state, effectId, outcome, ctx);
  if (!result.ok) return result;
  for (const draft of result.value.drafts) builder.add(draft);
  builder.commands.push(...result.value.commands);
  return ok(builder.finish());
}

/** retry 只授予原 Effect 新的执行许可；abandon 保留 unknown 并终结任务。 */
export function reconcileDecision(
  state: SessionState,
  effectId: string,
  decision: { kind: 'retry' } | { kind: 'abandon'; reason: string },
  ctx: SessionContext,
): Result<SessionDecision, ArcherError> {
  const turn = activeTurnOf(state);
  const effect = turn && lastEffectOf(turn);
  if (
    !turn ||
    !effect ||
    effect.effectId !== effectId ||
    effect.effect.type !== 'CALL' ||
    effect.status !== 'unknown' ||
    effect.abandoned
  ) {
    return err(new ArcherError('CONFLICT', '结果对账项已经改变'));
  }
  const builder = new DraftBuilder(state);
  if (decision.kind === 'retry') {
    if (turn.cancel) return err(new ArcherError('CONFLICT', '已请求取消，不能重试未知操作'));
    builder.turn(turn.turnId, {
      type: 'effect.resumed',
      data: { effectId, attempt: effect.attempt, kind: 'reconcile_retry', resumedAt: ctx.now },
    });
    builder.commands.push({ type: 'dispatch_effect', effectId });
  } else {
    builder.turn(turn.turnId, {
      type: 'effect.abandoned',
      data: { effectId, reason: decision.reason, abandonedAt: ctx.now },
    });
    if (turn.cancel) settleTurnCancellation(builder, turn, turn.cancel.reason ?? 'aborted', ctx);
    else {
      failTurn(
        builder,
        turn,
        {
          code: 'UNKNOWN_SIDE_EFFECT',
          message: `已放弃追踪未知操作：${decision.reason}。原操作是否生效仍未知。`,
        },
        ctx,
      );
    }
  }
  return ok(builder.finish());
}
