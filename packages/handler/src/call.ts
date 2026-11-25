/** CALL / CALL_BATCH 末端：调用已解析能力，保留读失败与写入未知的区别。 */
import {
  CallBatchResultSchema,
  CallResultSchema,
  OperationRejected,
  assertJsonValue,
  validateInput,
  type CallBatchEffect,
  type CallBatchItemResult,
  type CallEffect,
  type CallResult,
  type JsonValue,
} from '@archer/contracts';
import type { SessionEffectOutcome } from '@archer/agent';
import type { EffectTarget, HandlerContext } from './pipeline.js';
import { abortedOutcome, elapsedMs, toErrorData, unknownSideEffect } from './outcome.js';

async function invokeTarget(
  target: EffectTarget,
  input: JsonValue,
  context: HandlerContext,
): Promise<CallResult> {
  const files =
    target.metadata.execution === 'read' && context.files
      ? {
          ...context.files,
          write: async () => {
            throw new OperationRejected('Read-only execution cannot write files.', 'PERMISSION_DENIED');
          },
        }
      : context.files;
  const value = await target.invoke(structuredClone(input), {
    signal: context.signal,
    files,
    workspace: context.workspace,
    history: context.history,
    call: { turnId: context.turnId, target: target.ref },
  });
  assertJsonValue(value, 'Capability result');
  const outputView = target.metadata.resultView === 'output';
  let modelContent: string | undefined;
  if (outputView) {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('output' in value) ||
      typeof value.output !== 'string'
    ) {
      throw new Error('Tool resultView output requires a string output field.');
    }
    if ('isError' in value && typeof value.isError !== 'boolean') {
      throw new Error('Tool resultView output requires a boolean isError when provided.');
    }
    modelContent = value.output;
  }
  const isError =
    outputView &&
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'isError' in value &&
    value.isError === true;
  return CallResultSchema.parse({
    value,
    ...(modelContent === undefined ? {} : { modelContent }),
    ...(isError ? { isError: true } : {}),
  });
}

/** 能力调用失败按声明的执行语义归类，写入窗口异常保留未知。 */
export async function call(effect: CallEffect, context: HandlerContext): Promise<SessionEffectOutcome | null> {
  if (context.signal.aborted) return abortedOutcome(context);
  const startedAt = context.now();
  const target = context.target!;
  try {
    const result = await invokeTarget(target, effect.input, context);
    return { status: 'completed', result, durationMs: elapsedMs(startedAt, context) };
  } catch (error) {
    if (context.signal.aborted && context.isStopping()) return null;
    if (target.metadata.execution === 'read' || error instanceof OperationRejected) {
      return { status: 'failed', error: toErrorData(error), durationMs: elapsedMs(startedAt, context) };
    }
    return unknownSideEffect(error instanceof Error ? error.message : String(error));
  }
}

/** 并发执行只读能力批次；保留原顺序结果，停止中断时返回 null 以便安全重放。 */
export async function callBatch(
  effect: CallBatchEffect,
  context: HandlerContext,
): Promise<SessionEffectOutcome | null> {
  if (context.signal.aborted) return abortedOutcome(context);
  const startedAt = context.now();
  const targets = context.batchTargets ?? [];
  let stoppingAborted = false;

  const results: CallBatchItemResult[] = await Promise.all(
    effect.calls.map(async (item, index): Promise<CallBatchItemResult> => {
      const target = targets[index];
      if (!target) {
        return { status: 'failed', error: { code: 'EFFECT_UNSUPPORTED', message: 'Capability is unavailable.' } };
      }
      try {
        validateInput(target.metadata.inputSchema, item.input);
      } catch (error) {
        return {
          status: 'failed',
          error: { code: 'INVALID_ARGUMENT', message: error instanceof Error ? error.message : String(error) },
        };
      }
      try {
        const result = await invokeTarget(target, item.input, context);
        return { status: 'completed', result };
      } catch (error) {
        if (context.signal.aborted && context.isStopping()) {
          stoppingAborted = true;
        }
        return { status: 'failed', error: toErrorData(error) };
      }
    }),
  );

  if (stoppingAborted || (context.signal.aborted && context.isStopping())) return null;
  if (context.signal.aborted) return abortedOutcome(context);

  return {
    status: 'completed',
    result: CallBatchResultSchema.parse({ results }),
    durationMs: elapsedMs(startedAt, context),
  };
}
