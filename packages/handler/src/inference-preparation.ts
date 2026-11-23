/** 执行固定准备引用并生成本次参考，注入由推理流程负责；不重建会话历史。 */
import type { InferEffect } from '@archer/contracts';
import type { HandlerContext } from './pipeline.js';
import { preparationReference } from './prompt/preparation.js';

export async function prepareInference(effect: InferEffect, context: HandlerContext) {
  const preparations = [];
  const references: Array<{ role: 'user'; content: string }> = [];
  let totalBytes = 0;
  for (const request of effect.preparations ?? []) {
    if (context.signal.aborted) return null;
    const result = { ...request, value: await context.prepare(request) };
    const serialized = JSON.stringify(result);
    const bytes = new TextEncoder().encode(serialized).byteLength;
    totalBytes += bytes;
    if (bytes > 65_536 || totalBytes > 262_144) throw new Error('Inference preparation result exceeds the size limit.');
    preparations.push(result);
    references.push({ role: 'user', content: preparationReference(JSON.stringify(result.value)) });
  }
  return { references, preparations };
}
