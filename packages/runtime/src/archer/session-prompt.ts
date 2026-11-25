/**
 * Archer Harness — 锁外 Prompt 编译与版本重验
 *
 * 在提交锁内捕获快照版本，锁外编译工具投影与系统前缀，
 * 回到锁内重验 seq 未漂移后再执行提交。
 */

import type { Camp, CapabilityRef } from '@archer/contracts';
import { ArcherError, canonicalJson } from '@archer/contracts';
import { INFERENCE_PREPARE } from '@archer/camp';
import { compileTurnPrompt, type PromptFrame, type SessionState } from '@archer/agent';
import { compileModelTools } from '../prompt/model-tools.js';
import { STALE_PROMPT, type PromptPreparation } from './session-runtime-types.js';

export interface PromptCoordinatorHost {
  withLock<T>(task: () => Promise<T>): Promise<T>;
  getState(): SessionState;
  getCamp(): Camp;
  getInference(): CapabilityRef;
  getPreparations(): readonly CapabilityRef[];
  getLifecycleSignal(): AbortSignal;
  getPromptPreparations(): Set<PromptPreparation>;
  getPreparationTasks(): Set<Promise<PromptFrame>>;
}

/** 锁内选择事实版本，锁外准备；提交前校验版本，失效结果不进入事实。 */
export async function withPreparedPrompt<T>(
  host: PromptCoordinatorHost,
  needsPrompt: () => boolean,
  apply: (frame: PromptFrame | undefined) => Promise<T>,
  inputRequest = true,
  parentSignal?: AbortSignal,
): Promise<T> {
  const promptPreparations = host.getPromptPreparations();
  for (;;) {
    const selected = await host.withLock(
      async (): Promise<{ result: T } | { preparation: PromptPreparation }> => {
        if (!needsPrompt()) return { result: await apply(undefined) };
        const state = host.getState();
        const preparation: PromptPreparation = {
          seq: state.seq,
          controller: new AbortController(),
          snapshot: structuredClone({
            instructions: state.instructions,
            workspace: state.workspace,
          }),
        };
        promptPreparations.add(preparation);
        return { preparation };
      },
    );
    if ('result' in selected) return selected.result;
    const preparation = selected.preparation;
    const signal = AbortSignal.any([
      host.getLifecycleSignal(),
      preparation.controller.signal,
      ...(parentSignal ? [parentSignal] : []),
    ]);
    try {
      const frame = await preparePromptTask(host, preparation, signal);
      const applied = await host.withLock(async (): Promise<{ result: T } | { retry: true }> => {
        promptPreparations.delete(preparation);
        if (signal.aborted) throw signal.reason;
        if (host.getState().seq !== preparation.seq) return { retry: true };
        // 状态未变仍重做准入检查，避免停止或隔离后接收迟到的输入。
        if (!needsPrompt()) return { retry: true };
        // 编译完成且事实重验后固定准备能力及其输入。
        const camp = host.getCamp();
        const preparations = host
          .getPreparations()
          .map((ref) => {
            camp.resolve(ref, INFERENCE_PREPARE);
            const item = camp
              .list(INFERENCE_PREPARE)
              .find((entry) => canonicalJson(entry.ref) === canonicalJson(ref));
            if (!item) throw new Error('Preparation capability is unavailable.');
            return {
              ref,
              input: structuredClone(item.metadata.input),
              ...(item.metadata.order === undefined ? {} : { order: item.metadata.order }),
            };
          })
          .sort(
            (a, b) =>
              (a.order ?? 0) - (b.order ?? 0) ||
              canonicalJson(a.ref).localeCompare(canonicalJson(b.ref)),
          );
        const preparedFrame = { ...frame, preparations };
        return { result: await apply(preparedFrame) };
      });
      if ('result' in applied) return applied.result;
    } catch (error) {
      if (signal.aborted) {
        if (parentSignal?.aborted) throw new ArcherError('ABORTED', '恢复准备已取消');
        if (signal.reason === STALE_PROMPT || !inputRequest) continue;
        if (signal.reason instanceof ArcherError) throw signal.reason;
        throw new ArcherError('ABORTED', '输入准备已取消');
      }
      throw error;
    } finally {
      promptPreparations.delete(preparation);
    }
  }
}

/** 调用方可提前停止等待；实际准备工作仍跟踪到结束，保护租约与共享依赖。 */
function preparePromptTask(
  host: PromptCoordinatorHost,
  preparation: PromptPreparation,
  signal: AbortSignal,
): Promise<PromptFrame> {
  if (signal.aborted) return Promise.reject(signal.reason);
  const task = buildPromptFrame(host, preparation, signal);
  const preparationTasks = host.getPreparationTasks();
  preparationTasks.add(task);
  void task.then(
    () => preparationTasks.delete(task),
    () => preparationTasks.delete(task),
  );
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    void task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** 只使用捕获的会话快照编译工具，准备过程不持有提交锁。 */
async function buildPromptFrame(
  host: PromptCoordinatorHost,
  preparation: PromptPreparation,
  signal: AbortSignal,
): Promise<PromptFrame> {
  const check = () => {
    if (signal.aborted) throw signal.reason;
  };
  check();
  const snapshot = preparation.snapshot;
  const tools = compileModelTools(host.getCamp());
  check();
  const frame = compileTurnPrompt({
    instructions: snapshot.instructions,
    workspace: snapshot.workspace,
  });
  check();
  return { ...frame, tools, inference: host.getInference() };
}
