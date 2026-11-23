/** 通过本机调试端口采样，不读取正文、不改动业务状态，也不触发 Agent 执行。 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { setTimeout, clearTimeout } from 'node:timers';

const { URL, fetch, WebSocket, AbortSignal } = globalThis;

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const endpoint = new URL(option('--endpoint', 'http://127.0.0.1:9333'));
if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) {
  throw new Error('诊断仅连接本机 HTTP 调试端口');
}
const seconds = Number(option('--seconds', '10'));
if (!Number.isFinite(seconds) || seconds < 1 || seconds > 60) throw new Error('采样时长必须在 1 到 60 秒之间');
const prefix = path.resolve(option('--output', '/tmp/archer-performance'));
const apiUrl = option('--api-url');
if (apiUrl) {
  const api = new URL(apiUrl);
  if (api.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname)) throw new Error('API 地址必须是本机 HTTP 地址');
}
const targets = await (await fetch(new URL('/json/list', endpoint), { signal: AbortSignal.timeout(5000) })).json();
const candidates = targets.filter(target => ['page', 'node'].includes(target.type));
const targetId = option('--target-id');
const target = targetId ? candidates.find(item => item.id === targetId) : candidates.length === 1 ? candidates[0] : undefined;
if (!target) throw new Error(`请通过 --target-id 选择目标：${candidates.map(item => `${item.id} (${item.type})`).join(', ')}`);
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('连接调试端口超时')), 5000);
  socket.addEventListener('open', () => {
    clearTimeout(timer);
    resolve();
  }, { once: true });
  socket.addEventListener('error', () => {
    clearTimeout(timer);
    reject(new Error('调试端口连接失败'));
  }, { once: true });
});
let nextId = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} 超时`));
    }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error('诊断表达式执行失败');
  return result.result.value;
}

async function phase() {
  if (target.type !== 'node' || !apiUrl) return undefined;
  // 令牌只在被采样的后端进程内使用，报告只包含运行数量与事件水位。
  return evaluate(`(async () => {
    const base = ${JSON.stringify(apiUrl)};
    const headers = { Authorization: 'Bearer ' + process.env.HARNESS_TOKEN };
    const list = await (await fetch(base + '/api/agents?limit=200', { headers, signal: AbortSignal.timeout(5000) })).json();
    if (!Array.isArray(list) || list.length >= 200) return { status: 'unknown' };
    const states = await Promise.all(list.map(item => fetch(base + '/api/agents/' + encodeURIComponent(item.id), { headers, signal: AbortSignal.timeout(5000) }).then(response => response.json())));
    if (states.some(state => typeof state.seq !== 'number')) return { status: 'unknown' };
    const activeTurns = states.filter(state => state.activeTurn).length;
    return { status: activeTurns ? 'active' : 'idle', agents: states.length, activeTurns, seqTotal: states.reduce((sum, state) => sum + state.seq, 0) };
  })()`);
}
let profiling = false;
try {
  const backend = target.type === 'node';
  // 后端统计使用进程 CPU 差值，不能把 ps 的近期平均值当成采样区间 CPU。
  const phaseBefore = await phase();
  const before = backend
    ? await evaluate('({cpu:process.cpuUsage(),time:Date.now(),memory:process.memoryUsage(),loop:process.getBuiltinModule("node:perf_hooks").performance.eventLoopUtilization(),resources:process.getActiveResourcesInfo()})')
    : await evaluate(`(() => {
      if (globalThis.__archerPerformanceCapture) throw new Error('已有采样');
      const state = { tasks: [], startedAt: performance.now() };
      state.observer = new PerformanceObserver(list => {
        for (const task of list.getEntries()) state.tasks.push({ startTime: task.startTime, duration: task.duration });
      });
      state.observer.observe({ type: 'longtask', buffered: false });
      globalThis.__archerPerformanceCapture = state;
      return { time: Date.now(), nodes: document.getElementsByTagName('*').length };
    })()`);
  if (!backend) await call('Performance.enable');
  const metricsBefore = backend ? undefined : await call('Performance.getMetrics');
  await call('Profiler.enable');
  await call('Profiler.start');
  profiling = true;
  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
  const { profile } = await call('Profiler.stop');
  profiling = false;
  const metricsAfter = backend ? undefined : await call('Performance.getMetrics');
  const after = backend
    ? await evaluate('({cpu:process.cpuUsage(),time:Date.now(),memory:process.memoryUsage(),loop:process.getBuiltinModule("node:perf_hooks").performance.eventLoopUtilization(),resources:process.getActiveResourcesInfo()})')
    : await evaluate(`(() => {
      const state = globalThis.__archerPerformanceCapture;
      for (const task of state.observer.takeRecords()) {
        state.tasks.push({ startTime: task.startTime, duration: task.duration });
      }
      state.observer.disconnect();
      delete globalThis.__archerPerformanceCapture;
      return { time: Date.now(), nodes: document.getElementsByTagName('*').length, longTasks: state.tasks };
    })()`);
  const counts = new Map();
  for (const id of profile.samples ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  const top = profile.nodes.map(node => ({ ...node.callFrame, samples: counts.get(node.id) ?? 0 }))
    .sort((a, b) => b.samples - a.samples).slice(0, 30);
  const report = {
    targetType: target.type, seconds, phaseBefore, phaseAfter: await phase(), before, after, metricsBefore, metricsAfter,
    cpuPercent: backend ? ((after.cpu.user - before.cpu.user) + (after.cpu.system - before.cpu.system)) / ((after.time - before.time) * 1000) * 100 : undefined,
    top,
  };
  await writeFile(`${prefix}.cpuprofile`, JSON.stringify(profile));
  await writeFile(`${prefix}.json`, JSON.stringify(report, null, 2));
  console.info(`已保存 ${prefix}.cpuprofile 和 ${prefix}.json`);
} finally {
  if (profiling) await call('Profiler.stop').catch(() => {});
  if (target.type === 'page') {
    await evaluate('globalThis.__archerPerformanceCapture?.observer.disconnect(); delete globalThis.__archerPerformanceCapture').catch(() => {});
    await call('Performance.disable').catch(() => {});
  }
  await call('Profiler.disable').catch(() => {});
  socket.close();
}
