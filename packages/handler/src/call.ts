/** CALL 末端：调用已解析能力，保留读失败与写入未知的区别。 */
import { CallResultSchema, assertJsonValue, OperationRejected, type CallEffect } from '@archer/contracts';
import type { SessionEffectOutcome } from '@archer/agent';
import type { HandlerContext } from './pipeline.js';
import { abortedOutcome, elapsedMs, toErrorData, unknownSideEffect } from './outcome.js';

/** 能力调用失败按声明的执行语义归类，写入窗口异常保留未知。 */
export async function call(effect: CallEffect, context: HandlerContext): Promise<SessionEffectOutcome | null> {
  if (context.signal.aborted) return abortedOutcome(context);
  const startedAt = context.now();
  const target = context.target!;
  try {
    const files = target.metadata.execution === 'read' && context.files
      ? { ...context.files, write: async () => { throw new OperationRejected('Read-only execution cannot write files.', 'PERMISSION_DENIED'); } }
      : context.files;
    const value = await target.invoke(structuredClone(effect.input), { signal: context.signal, files, workspace: context.workspace, history: context.history,
      call: { turnId: context.turnId, target: target.ref } });
    assertJsonValue(value, 'Capability result');
    const outputView = target.metadata.resultView === 'output';
    let modelContent: string | undefined;
    if (outputView) {
      if (value === null || typeof value !== 'object' || Array.isArray(value) || !('output' in value) || typeof value.output !== 'string') {
        throw new Error('Tool resultView output requires a string output field.');
      }
      if ('isError' in value && typeof value.isError !== 'boolean') throw new Error('Tool resultView output requires a boolean isError when provided.');
      modelContent = value.output;
    }
    const isError = outputView && value !== null && typeof value === 'object' && !Array.isArray(value) && 'isError' in value && value.isError === true;
    const result = CallResultSchema.parse({ value, ...(modelContent === undefined ? {} : { modelContent }), ...(isError ? { isError: true } : {}) });
    return { status: 'completed', result, durationMs: elapsedMs(startedAt, context) };
  } catch (error) {
    if (context.signal.aborted && context.isStopping()) return null;
    if (target.metadata.execution === 'read' || error instanceof OperationRejected) return { status: 'failed', error: toErrorData(error), durationMs: elapsedMs(startedAt, context) };
    return unknownSideEffect(error instanceof Error ? error.message : String(error));
  }
}

