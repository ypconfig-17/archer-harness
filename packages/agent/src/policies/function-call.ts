import { cloneContextProfile, type InferConfig } from '@archer/contracts';
import { completionReviewTarget } from '../completion.js';
/** 默认会话 Agent 策略：模型协议、消息、计划与推理意图。 */
import type { Effect, ActionPlan, Message, TurnTerminal, InferResult, InferenceTool, CallResult, CallBatchResult, ToolCall } from '@archer/contracts';
import {
  formatObservation, formatObservationCancelled,
  TOOL_BATCH_REJECTION_LABEL, COMPLETION_REVIEW_LABEL, COMPLETION_REVIEW_NOTICE, EMPTY_RESPONSE_LABEL, EMPTY_RESPONSE_NOTICE, formatToolCallRejection, formatToolBatchRejection } from '../prompt/index.js';
import { agentInputText, agentInputMessage, isTerminalTurnStatus } from '@archer/contracts';
import { toolResultContent } from '../prompt/tool-result.js';
import type { SessionState, SessionTurn } from '../session.js';
import { lastEffectOf } from '../session.js';
import { DraftBuilder, closeToolCalls, requireTurn, failTurn, settleTurnCancellation, type SessionContext, type SessionDecision, type SessionEffectOutcome } from '../session-decision.js';

export type SessionPolicyInput =
  | { kind: 'turn.started'; turnId: string; promptFrame: import('../prompt/types.js').PromptFrame }
  | { kind: 'effect.settled'; turnId: string; effectId: string; outcome: Exclude<SessionEffectOutcome, { status: 'unknown' }> };

/** Agent 的纯决策策略；执行机制只依赖 id 与 decide */
export interface SessionAgentPolicy {
  readonly id: string;
  decide(state: SessionState, input: SessionPolicyInput, context: SessionContext): SessionDecision;
}

/**
 * 读取 Turn 第一个 INFER 已提交的固定前缀。
 * 前缀长度必须来自显式提交的计数，不为缺失事实补默认值。
 */
export function inferPrefixFor(turn: Pick<SessionTurn, 'effects'>): Message[] {
  const first = turn.effects.find((effect) => effect.effect.type === 'INFER');
  if (first?.effect.type !== 'INFER') return [];
  return first.effect.messages.slice(0, first.effect.promptPrefixCount);
}

/**
 * 后续推理沿用首个已提交请求的上下文管理快照，避免任务中途受页面修改影响。
 * 首个 INFER 已经提交完整配置，不为缺失事实补默认值；更早的默认值只用于生成首个请求。
 */
function inferenceForTurn(state: SessionState, turn: SessionTurn): InferConfig {
  const config = { ...state.inference, ...turn.inference };
  const first = turn.effects.find(item => item.effect.type === 'INFER');
  const profile = first?.effect.type === 'INFER'
    ? first.effect.config?.contextProfile
    : turn.inference?.contextProfile ?? state.inference?.contextProfile;
  delete config.contextProfile;
  if (profile) config.contextProfile = cloneContextProfile(profile);
  return config;
}

function effectIdFor(turn: SessionTurn): string {
  return `${turn.turnId}:e${turn.effects.length + 1}`;
}
function addObservation(builder: DraftBuilder, turnId: string, label: string, content: string): void {
  builder.turn(turnId, {
    type: 'message.appended',
    data: {
      message: {
        role: 'user',
        content: formatObservation(label, content),
      },
    },
  });
}
function consumeSteeringIfAny(
  builder: DraftBuilder,
  turn: SessionTurn,
): boolean {
  const pending = builder.state.pendingSteering.filter((item) => item.turnId === turn.turnId);
  if (pending.length === 0) return false;
  for (const item of pending) {
    builder.agent({
      type: 'steering.consumed',
      data: { inputId: item.inputId, turnId: turn.turnId },
    });
    builder.turn(turn.turnId, {
      type: 'message.appended',
      data: {
        message: { ...agentInputMessage(item.input), content: `[User steering]\n${agentInputText(item.input)}` },
      },
    });
  }
  return true;
}
function finishTurn(
  builder: DraftBuilder,
  turn: SessionTurn,
  terminal: TurnTerminal,
  ctx: SessionContext,
): void {
  builder.turn(turn.turnId, {
    type: 'turn.completed',
    data: {
      ...(terminal.kind === 'done' && terminal.summary.length > 0
        ? { summary: terminal.summary }
        : {}),
      stopReason: terminal.kind,
      completedAt: ctx.now,
    },
  });
}
/** 工具映射固定于 Turn 首次推理；能力返回数据不能改变候选集合。 */
function toolsForTurn(turn: SessionTurn): InferenceTool[] {
  const first = turn.effects.find(item => item.effect.type === 'INFER');
  return first?.effect.type === 'INFER' ? [...(first.effect.tools ?? [])] : [];
}

/** 同一 Turn 允许模型从非法工具调用中恢复的次数；超过后仍按提供方错误终止。 */
const MAX_REJECTED_TOOL_BATCHES = 2;

/** 只有唯一调用身份和对象参数才能作为原生工具消息进入模型历史。 */
function representableBatch(calls: readonly ToolCall[], previousIds: ReadonlySet<string>): boolean {
  const ids = new Set(previousIds);
  for (const call of calls) {
    if (ids.has(call.id) || call.input === null || typeof call.input !== 'object' || Array.isArray(call.input)) return false;
    ids.add(call.id);
  }
  return true;
}

/** 执行前拒绝原因；非法调用不会产生 Effect。 */
function rejectionOf(call: ToolCall, tools: readonly InferenceTool[], ids: ReadonlySet<string>): string | undefined {
  const tool = tools.find(entry => entry.name === call.name);
  if (!tool) return `unknown tool "${call.name}"`;
  if (ids.has(call.id)) return `duplicate tool call id "${call.id}"`;
  if (call.input === null || typeof call.input !== 'object' || Array.isArray(call.input)) return 'arguments must be a JSON object';
  if (tool.wrappedInput && !('input' in call.input)) return 'arguments must contain the required input wrapper';
  return undefined;
}

/** 重放既有推理结果，统计本 Turn 在 currentEffectId 之前被拒绝的批次。 */
function rejectedBatchCount(turn: SessionTurn, currentEffectId: string): number {
  let count = 0;
  for (const item of turn.effects) {
    if (item.effectId === currentEffectId) break;
    if (item.effect.type !== 'INFER' || item.status !== 'completed') continue;
    const calls = (item.result as InferResult | undefined)?.toolCalls ?? [];
    if (calls.length === 0) continue;
    const tools = item.effect.tools ?? [];
    const ids = new Set(item.effect.messages.flatMap(message => (message.toolCalls ?? []).map(call => call.id)));
    let rejected = false;
    for (const call of calls) {
      if (rejectionOf(call, tools, ids)) {
        rejected = true;
        break;
      }
      ids.add(call.id);
    }
    if (rejected) count += 1;
  }
  return count;
}

function createInferEffect(
  builder: DraftBuilder,
  turn: SessionTurn,
  ctx: SessionContext,
): void {
  const state = builder.state;
  const effectId = effectIdFor(turn);
  const step = turn.inferenceSteps + 1;
  const prefix = inferPrefixFor(turn);
  const first = turn.effects.find(item => item.effect.type === 'INFER');
  const effect: Effect = {
    type: 'INFER',
    target: first?.effect.type === 'INFER' ? first.effect.target : (() => { throw new Error('Missing inference target.'); })(),
    tools: toolsForTurn(turn),
    preparations: first?.effect.type === 'INFER' ? first.effect.preparations ?? [] : [],
    messages: [...prefix, ...state.messages],
    promptPrefixCount: prefix.length,
    config: inferenceForTurn(state, turn),
  };
  builder.turn(turn.turnId, {
    type: 'inference.started',
    data: { step, startedAt: ctx.now },
  });
  builder.turn(turn.turnId, {
    type: 'effect.created',
    data: {
      effectId,
      effect,
      idempotencyKey: `${effectId}:infer`,
      createdAt: ctx.now,
    },
  });
  builder.commands.push({ type: 'dispatch_effect', effectId });
}
function isBatchableReadAction(action: ActionPlan): boolean {
  return action.readOnly === true && !action.interaction;
}

function createActionEffect(
  builder: DraftBuilder,
  turn: SessionTurn,
  actions: readonly ActionPlan[],
  index: number,
  ctx: SessionContext,
): void {
  const first = actions[index]!;
  const effectId = effectIdFor(turn);
  let effect: Effect;
  let idempotencyKey: string;

  if (isBatchableReadAction(first)) {
    const batch: ActionPlan[] = [first];
    for (let cursor = index + 1; cursor < actions.length; cursor += 1) {
      const candidate = actions[cursor]!;
      if (!isBatchableReadAction(candidate)) break;
      batch.push(candidate);
    }
    if (batch.length >= 2) {
      effect = {
        type: 'CALL_BATCH',
        calls: batch.map(item => ({
          target: item.target,
          input: item.input,
          toolCallId: item.toolCallId,
          toolName: item.toolName,
        })),
      };
      idempotencyKey = `${effectId}:batch:${index}:${batch.length}`;
    } else {
      effect = {
        type: 'CALL',
        target: first.target,
        input: first.input,
        toolCallId: first.toolCallId,
        toolName: first.toolName,
        ...(first.interaction ? { interaction: first.interaction } : {}),
      };
      idempotencyKey = `${effectId}:action:${index}:${first.kind}`;
    }
  } else {
    effect = {
      type: 'CALL',
      target: first.target,
      input: first.input,
      toolCallId: first.toolCallId,
      toolName: first.toolName,
      ...(first.interaction ? { interaction: first.interaction } : {}),
    };
    idempotencyKey = `${effectId}:action:${index}:${first.kind}`;
  }

  builder.turn(turn.turnId, {
    type: 'effect.created',
    data: {
      effectId,
      effect,
      idempotencyKey,
      createdAt: ctx.now,
    },
  });

  builder.commands.push({ type: 'dispatch_effect', effectId });
}
function continuePlan(
  builder: DraftBuilder,
  turnId: string,
  ctx: SessionContext,
): void {
  let turn = requireTurn(builder.state, turnId);
  if (isTerminalTurnStatus(turn.status)) return;

  if (turn.cancel || turn.status === 'cancelling') {
    const last = lastEffectOf(turn);
    if (last && (last.status === 'unknown' || last.status === 'started')) return;
    settleTurnCancellation(builder, turn, turn.cancel?.reason ?? 'aborted', ctx);
    return;
  }

  if (builder.state.pendingSteering.some(item => item.turnId === turn.turnId)) closeToolCalls(builder, turn, 'Skipped because the user supplied new steering.');
  if (consumeSteeringIfAny(builder, turn)) {
    turn = requireTurn(builder.state, turnId);
    if (turn.limits.maxInferenceSteps !== undefined && turn.inferenceSteps >= turn.limits.maxInferenceSteps) {
      failTurn(builder, turn, {
        code: 'TURN_FAILED',
        message: '已达到本 Turn 的最大推理步数',
      }, ctx);
      return;
    }
    createInferEffect(builder, turn, ctx);
    return;
  }

  const plan = turn.plan;
  if (!plan) {
    failTurn(builder, turn, {
      code: 'INTERNAL',
      message: 'Turn 缺少已提交的执行计划',
    }, ctx);
    return;
  }

  if (plan.nextIndex < plan.actions.length) {
    createActionEffect(builder, turn, plan.actions, plan.nextIndex, ctx);
    return;
  }

  if (plan.terminal) {
    finishTurn(builder, turn, plan.terminal, ctx);
    return;
  }

  if (turn.limits.maxInferenceSteps !== undefined && turn.inferenceSteps >= turn.limits.maxInferenceSteps) {
    failTurn(builder, turn, {
      code: 'TURN_FAILED',
      message: '已达到本 Turn 的最大推理步数',
    }, ctx);
    return;
  }

  createInferEffect(builder, turn, ctx);
}
function decide(state: SessionState, input: SessionPolicyInput, ctx: SessionContext): SessionDecision {
  const builder = new DraftBuilder(state);
  const turn = requireTurn(builder.state, input.turnId);
  if (input.kind === 'turn.started') {
    const effectId = effectIdFor(turn);
    builder.turn(turn.turnId, { type: 'inference.started', data: { step: 1, startedAt: ctx.now } });
    builder.turn(turn.turnId, {
      type: 'effect.created',
      data: {
        effectId,
        effect: {
          type: 'INFER',
          target: input.promptFrame.inference!,
          tools: [...input.promptFrame.tools],
          preparations: [...input.promptFrame.preparations],
          messages: [...input.promptFrame.prefix, ...builder.state.messages],
          promptPrefixCount: input.promptFrame.prefix.length,
          config: inferenceForTurn(state, turn),
        },
        idempotencyKey: `${effectId}:infer`, createdAt: ctx.now,
      },
    });
    builder.commands.push({ type: 'dispatch_effect', effectId });
    return builder.finish();
  }
  const effect = turn.effects.find((item) => item.effectId === input.effectId);
  if (!effect) throw new Error('Agent 策略引用了不存在的 Effect');
  const outcome = input.outcome;
  if (outcome.status === 'completed') {
    if (effect.effect.type === 'INFER') {
      const result = outcome.result as InferResult;
      const calls = result.toolCalls ?? [];
      // 截断内容保留在推理事实中，不进入普通答复或工具执行计划。
      if (result.stopReason === 'length') {
        failTurn(builder, turn, { code: 'MODEL_OUTPUT_TRUNCATED', message: 'Model output reached its length limit; the response is incomplete and no calls from it were executed.' }, ctx);
        return builder.finish();
      }
      if (result.stopReason === 'toolUse' && calls.length === 0) {
        failTurn(builder, turn, { code: 'MODEL_TOOL_CALL_MISSING', message: 'Model requested tool execution but returned no tool call; the task was not completed.' }, ctx);
        return builder.finish();
      }
      if (calls.length === 0 && !result.content.trim()) {
        const previous = turn.effects.filter(item => item.effect.type === 'INFER' && item.effectId !== effect.effectId).at(-1);
        const prior = previous?.status === 'completed' ? previous.result as InferResult | undefined : undefined;
        if (prior && !(prior.toolCalls?.length) && !prior.content.trim()) {
          failTurn(builder, turn, { code: 'MODEL_EMPTY_RESPONSE', message: 'Model returned two consecutive empty responses; no final answer was produced.' }, ctx);
          return builder.finish();
        }
        addObservation(builder, turn.turnId, EMPTY_RESPONSE_LABEL, EMPTY_RESPONSE_NOTICE);
        builder.turn(turn.turnId, { type: 'inference.planned', data: { step: turn.inferenceSteps, actions: [] } });
        continuePlan(builder, turn.turnId, ctx);
        return builder.finish();
      }
      const reviewAfter = calls.length === 0 ? completionReviewTarget(turn) : undefined;
      if (reviewAfter && turn.completionReviewAfter !== reviewAfter) {
        builder.turn(turn.turnId, { type: 'completion.review.requested', data: { afterEffectId: reviewAfter, requestedAt: ctx.now } });
        addObservation(builder, turn.turnId, COMPLETION_REVIEW_LABEL, COMPLETION_REVIEW_NOTICE);
        builder.turn(turn.turnId, { type: 'inference.planned', data: { step: turn.inferenceSteps, actions: [] } });
        continuePlan(builder, turn.turnId, ctx);
        return builder.finish();
      }
      const tools = effect.effect.tools ?? [];
      const actions: ActionPlan[] = [];
      const ids = new Set(effect.effect.messages.flatMap(message => (message.toolCalls ?? []).map(call => call.id)));
      const representable = representableBatch(calls, ids);
      const rejected: { call: ToolCall; reason: string }[] = [];
      for (const call of calls) {
        const reason = rejectionOf(call, tools, ids);
        ids.add(call.id);
        if (reason) {
          rejected.push({ call, reason });
          continue;
        }
        const tool = tools.find(entry => entry.name === call.name)!;
        actions.push({ kind: 'call', target: tool.target, input: tool.wrappedInput ? (call.input as import('@archer/contracts').JsonObject).input : call.input, toolCallId: call.id, toolName: call.name, ...(tool.interaction ? { interaction: tool.interaction } : {}), ...(tool.readOnly ? { readOnly: true } : {}) });
      }
      if (representable) {
        builder.turn(turn.turnId, {
          type: 'message.appended',
          data: { message: { role: 'assistant', content: result.content, ...(calls.length ? { toolCalls: calls } : {}), ...(result.reasoning === undefined ? {} : { reasoning: result.reasoning }), ...(result.reasoningReplay === undefined ? {} : { reasoningReplay: result.reasoningReplay }) } },
        });
      }
      if (rejected.length > 0) {
        // 只反馈本次已提交声明中的名称，帮助模型纠正，不暴露内部引用或猜测调用目标。
        const toolNames = tools.map(tool => tool.name);
        if (!representable) {
          addObservation(builder, turn.turnId, TOOL_BATCH_REJECTION_LABEL, formatToolBatchRejection(rejected.map(item => item.reason), toolNames));
        } else {
          const reasons = new Map(rejected.map(item => [item.call.id, item.reason]));
          for (const call of calls) {
            const reason = reasons.get(call.id);
            if (!reason) continue;
            builder.turn(turn.turnId, {
              type: 'message.appended',
              data: {
                message: {
                  role: 'tool', toolCallId: call.id, toolName: call.name, isError: true,
                  content: formatToolCallRejection(reason, toolNames),
                },
              },
            });
          }
        }
        if ((!representable || actions.length === 0) && rejectedBatchCount(turn, effect.effectId) >= MAX_REJECTED_TOOL_BATCHES) {
          failTurn(builder, turn, {
            code: 'PROVIDER_ERROR',
            message: `Model repeatedly returned invalid tool calls (${rejected.map(item => item.reason).join('; ')}).`,
          }, ctx);
          return builder.finish();
        }
        builder.turn(turn.turnId, {
          type: 'inference.planned',
          data: { step: turn.inferenceSteps, actions: representable ? actions : [] },
        });
        continuePlan(builder, turn.turnId, ctx);
        return builder.finish();
      }
      builder.turn(turn.turnId, {
        type: 'inference.planned',
        data: {
          step: turn.inferenceSteps,
          actions,
          ...(calls.length === 0 ? { terminal: { kind: 'respond' as const, content: result.content } } : {}),
        },
      });
      continuePlan(builder, turn.turnId, ctx);
      return builder.finish();
    }

    if (effect.effect.type === 'CALL') {
      builder.turn(turn.turnId, { type: 'message.appended', data: { message: { role: 'tool', content: toolResultContent(outcome.result as CallResult), ...((outcome.result as CallResult).isError ? { isError: true } : {}), toolCallId: effect.effect.toolCallId, toolName: effect.effect.toolName } } });
      if (effect.effect.interaction === 'human' && (outcome.result as CallResult).value && typeof (outcome.result as CallResult).value === 'object' && ((outcome.result as CallResult).value as { approved?: boolean }).approved === false) {
        failTurn(builder, turn, { code: 'PERMISSION_DENIED', message: '用户拒绝了本次请求，剩余计划未执行。' }, ctx);
        return builder.finish();
      }
    } else if (effect.effect.type === 'CALL_BATCH') {
      const batchResult = outcome.result as CallBatchResult;
      for (let i = 0; i < effect.effect.calls.length; i += 1) {
        const call = effect.effect.calls[i]!;
        const item = batchResult.results[i];
        if (item?.status === 'completed') {
          builder.turn(turn.turnId, {
            type: 'message.appended',
            data: {
              message: {
                role: 'tool',
                content: toolResultContent(item.result),
                ...(item.result.isError ? { isError: true } : {}),
                toolCallId: call.toolCallId,
                toolName: call.toolName,
              },
            },
          });
        } else {
          builder.turn(turn.turnId, {
            type: 'message.appended',
            data: {
              message: {
                role: 'tool',
                content: JSON.stringify({ outcome: 'failed', error: item?.error ?? { code: 'INTERNAL', message: 'Missing batch call result.' } }),
                toolCallId: call.toolCallId,
                toolName: call.toolName,
                isError: true,
              },
            },
          });
        }
      }
    }

    continuePlan(builder, turn.turnId, ctx);
    return builder.finish();
  }
  if (outcome.status === 'failed') {
    if (effect.effect.type === 'INFER') {
      failTurn(builder, turn, outcome.error, ctx);
      return builder.finish();
    }
    if (effect.effect.type === 'CALL') {
      builder.turn(turn.turnId, { type: 'message.appended', data: { message: { role: 'tool', content: JSON.stringify({ outcome: 'failed', error: outcome.error }), toolCallId: effect.effect.toolCallId, toolName: effect.effect.toolName, isError: true } } });
    } else if (effect.effect.type === 'CALL_BATCH') {
      for (const call of effect.effect.calls) {
        builder.turn(turn.turnId, { type: 'message.appended', data: { message: { role: 'tool', content: JSON.stringify({ outcome: 'failed', error: outcome.error }), toolCallId: call.toolCallId, toolName: call.toolName, isError: true } } });
      }
    }
  } else {
    addObservation(builder, turn.turnId, effect.effect.type.toLowerCase(), formatObservationCancelled(outcome.reason));
  }
  continuePlan(builder, turn.turnId, ctx);
  return builder.finish();
}

export const functionCallSessionPolicy: SessionAgentPolicy = Object.freeze({ id: 'function-call', decide });

/** 提案只允许产生 Agent 行为事实，不能伪造 Effect 执行结果。 */
export function applySessionPolicy(builder: DraftBuilder, input: SessionPolicyInput, ctx: SessionContext): void {
  const policy = ctx.agentPolicy ?? functionCallSessionPolicy;
  if (policy.id !== builder.state.policyId) {
    throw new Error('Agent 策略与持久化声明不一致');
  }
  const proposal = policy.decide(builder.state, input, ctx);
  const created = new Set<string>();
  const allowed = new Set(['message.appended', 'inference.started', 'inference.planned', 'completion.review.requested', 'effect.created', 'turn.completed', 'turn.failed']);
  for (const draft of proposal.drafts) {
    if (draft.scope === 'turn') {
      if (draft.turnId !== input.turnId || !allowed.has(draft.event.type)) throw new Error('Agent 策略提交了越界事实');
      if (draft.event.type === 'effect.created') {
        if (created.size > 0) throw new Error('同一 Turn 只能提出一个待执行 Effect');
        created.add(draft.event.data.effectId);
      }
    } else if (draft.event.type !== 'steering.consumed' || draft.event.data.turnId !== input.turnId) {
      throw new Error('Agent 策略不能改变会话控制状态');
    }
    builder.add(draft);
  }
  for (const command of proposal.commands) {
    if (command.type === 'abort_effect' || !created.delete(command.effectId)) throw new Error('Agent 策略只能调度本批新建 Effect');
    builder.commands.push(command);
  }
  if (created.size > 0) throw new Error('Agent 策略创建的 Effect 缺少调度命令');
  const turn = requireTurn(builder.state, input.turnId);
  const pending = turn.effects.filter(effect => !effect.abandoned && !['completed', 'failed', 'cancelled'].includes(effect.status));
  if (pending.length > 1 || (isTerminalTurnStatus(turn.status) && pending.length > 0)) {
    throw new Error('Agent 策略违反单 Effect 或终态收束约束');
  }
}
