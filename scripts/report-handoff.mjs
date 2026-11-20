/** 只读指定日志并输出不含原文的诊断；不扫描目录、不修复日志、不调用模型。 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { AgentEventSchema } from '../packages/contracts/dist/index.js';
import { replayAgent } from '../packages/agent/dist/index.js';
import { handoffReport } from '../packages/handler/dist/index.js';

export async function reportFile(path) {
  if (!path || !isAbsolute(path)) throw new Error('Provide an absolute Agent JSONL file path.');
  const raw = await readFile(path, 'utf8');
  if (!raw.endsWith('\n')) throw new Error('Incomplete JSONL tail; reporting does not repair logs.');
  const events = raw.split('\n').filter(line => line.trim()).flatMap(line => {
    try {
      const batch = JSON.parse(line);
      if (!Array.isArray(batch) || !batch.length) throw new Error('Expected nonempty event batches.');
      return batch.map(event => AgentEventSchema.parse(event));
    } catch { throw new Error('Invalid JSONL event batch; report was not generated.'); }
  });
  if (!events.length) throw new Error('Empty journal.');
  const state = replayAgent(events[0].agentId, events);
  if (!state) throw new Error('Missing Agent facts.');
  return handoffReport(state);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(await reportFile(process.argv[2]), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
