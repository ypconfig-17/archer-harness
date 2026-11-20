/** 对同一份 JSONL 比较追加延迟与逻辑读取字节；旧实现只从显式外部快照加载。 */
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { tmpdir, cpus, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import console from 'node:console';
import ts from 'typescript';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const baselinePath = option('--baseline');
if (!baselinePath) throw new Error('必须通过 --baseline 指定优化前 agent-journal.ts 的外部快照');
const samples = Number(option('--samples', '40'));
if (!Number.isInteger(samples) || samples < 20 || samples > 500) throw new Error('samples 必须是 20 到 500 的整数');
const output = resolve(option('--output', '/tmp/archer-journal-benchmark.json'));
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await fs.mkdtemp(join(tmpdir(), 'archer-journal-benchmark-'));
const oldReadFile = fs.readFile;
const oldOpen = fs.open;
let recording = false;
let readBytes = 0;
const count = data => {
  if (recording) readBytes += typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
};
fs.readFile = async (...args) => {
  const data = await oldReadFile(...args);
  count(data);
  return data;
};
fs.open = async (...args) => {
  const handle = await oldOpen(...args);
  if (String(args[0]).endsWith('.jsonl')) {
    const read = handle.readFile.bind(handle);
    handle.readFile = async (...readArgs) => {
      const data = await read(...readArgs);
      count(data);
      return data;
    };
  }
  return handle;
};
syncBuiltinESMExports();

try {
  const baselineSource = await fs.readFile(resolve(baselinePath), 'utf8');
  const currentSource = await fs.readFile(join(root, 'packages/storage/src/agent-journal.ts'), 'utf8');
  const contracts = pathToFileURL(join(root, 'packages/contracts/dist/index.js')).href;
  const source = baselineSource.replaceAll("'@archer/contracts'", JSON.stringify(contracts));
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const baselineModule = join(temporary, 'baseline.mjs');
  await fs.writeFile(baselineModule, compiled);
  const { JsonlAgentJournal: Before } = await import(pathToFileURL(baselineModule).href);
  const { JsonlAgentJournal: After } = await import(pathToFileURL(join(root, 'packages/storage/dist/index.js')).href);
  const summary = 'x'.repeat(1024);
  const draft = { scope: 'turn', turnId: 'bench:t1', event: { type: 'turn.completed', data: { completedAt: 1, stopReason: 'respond', summary } } };
  const fixture = size => Array.from({ length: size }, (_, index) => JSON.stringify([{
    id: `bench:${index + 1}`, agentId: 'bench', seq: index + 1, ts: index + 1,
    fact: { ...draft, turnSeq: index + 1 },
  }])).join('\n') + '\n';
  const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
  async function run(Journal, name, size, raw, rounds = samples) {
    const directory = join(temporary, `${name}-${size}`);
    await fs.mkdir(directory);
    await fs.writeFile(join(directory, 'bench.jsonl'), raw);
    const journal = new Journal(directory);
    const observations = [];
    const cpuBefore = process.cpuUsage();
    try {
      for (let index = 0; index < rounds; index++) {
        readBytes = 0;
        recording = true;
        const started = performance.now();
        await journal.append({ agentId: 'bench', expectedSeq: size + index, drafts: [draft] });
        const durationMs = performance.now() - started;
        recording = false;
        observations.push({ durationMs, readBytes });
      }
    } finally {
      recording = false;
    }
    const cpu = process.cpuUsage(cpuBefore);
    // 基准本身也核对完整恢复结果，不只记录成功返回的耗时。
    const restored = await new Journal(directory).read('bench');
    if (restored.length !== size + rounds || restored.at(-1).fact.turnSeq !== size + rounds) {
      throw new Error('基准追加后的恢复结果不一致');
    }
    const durations = observations.map(item => item.durationMs);
    return {
      implementation: name, historyStart: size, historyEnd: size + rounds,
      initialBytes: Buffer.byteLength(raw), samples: rounds,
      p50Ms: percentile(durations, 0.5), p95Ms: percentile(durations, 0.95),
      totalMs: durations.reduce((sum, value) => sum + value, 0),
      meanReadBytes: observations.reduce((sum, item) => sum + item.readBytes, 0) / rounds,
      cpuMs: (cpu.user + cpu.system) / 1000,
      firstAppend: observations[0], observations,
    };
  }
  // 预热相同代码路径和协议库，但正式日志的第一次追加仍是冷缓存，并单独报告。
  await run(Before, 'warmup-before', 100, fixture(100), 3);
  await run(After, 'warmup-after', 100, fixture(100), 3);
  const results = [];
  for (const size of [100, 1000, 10000]) {
    const raw = fixture(size);
    const order = size === 1000 ? [[After, 'after'], [Before, 'before']] : [[Before, 'before'], [After, 'after']];
    for (const [Journal, name] of order) results.push(await run(Journal, name, size, raw));
  }
  const hash = text => createHash('sha256').update(text).digest('hex');
  const report = {
    environment: { node: process.version, platform: platform(), cpu: cpus()[0]?.model },
    baselineHash: hash(baselineSource), currentHash: hash(currentSource),
    method: 'Single-process sequential appends, identical 1024-character event payload; first cold append included; OS cache not flushed; two fsync calls included. Read bytes count bytes returned by filesystem APIs, not physical disk traffic.',
    results,
  };
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.table(results.map(({ implementation, historyStart, p50Ms, p95Ms, totalMs, meanReadBytes, cpuMs }) => ({
    implementation, historyStart, p50Ms, p95Ms, totalMs, meanReadBytes, cpuMs,
  })));
  console.info(`完整结果：${output}`);
} finally {
  fs.readFile = oldReadFile;
  fs.open = oldOpen;
  syncBuiltinESMExports();
  await fs.rm(temporary, { recursive: true, force: true });
}
