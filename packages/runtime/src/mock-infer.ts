/** 演示推理端口：对当前用户请求给出确定性的普通文本回复。 */
import type { InferEffect, InferResult, Inference } from '@archer/contracts';

export interface MockInferOptions { delayMs?: number }

export function createMockInference(options: MockInferOptions = {}): Inference {
  return {
    async infer(effect: InferEffect, signal: AbortSignal): Promise<InferResult> {
      if (signal.aborted) throw new Error('Inference aborted.');
      if (options.delayMs) await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new Error('Inference aborted.')); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, options.delayMs);
        signal.addEventListener('abort', abort, { once: true });
      });
      const task = effect.messages.filter(message => message.role === 'user').at(-1)?.content ?? '';
      return { content: `Mock turn completed for: ${task.replace(/\s+/g, ' ').slice(0, 80)}` };
    },
  };
}
