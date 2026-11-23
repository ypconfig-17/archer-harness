/** Archer 协调 Camp 借用、Context 装配和 Agent 生命周期，不管理 Provider 注册。 */
import type { AgentManager, Archer, ArcherOptions, ArcherState, ArcherContext, Camp, StopOptions } from '@archer/contracts';
import { ArcherError } from '@archer/contracts';
import { openDependency, type ResolvedDependency } from './dependencies.js';
import { AgentRegistry } from './agents.js';
import { createArcherContext, ARCHER_CLOCK, ARCHER_INFERENCE, ARCHER_JOURNAL } from '../context/application-context.js';
function validateTimeout(options: StopOptions): number | undefined {
  const timeoutMs = options.timeoutMs;
  if (timeoutMs === undefined) return undefined;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ArcherError('INVALID_ARGUMENT', 'timeoutMs 必须为正有限数');
  }
  return timeoutMs;
}

async function raceTimeout<T>(task: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (timeoutMs === undefined) return task;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ArcherError('SHUTDOWN_TIMEOUT', `停止超过预算：${timeoutMs}ms`, { timeoutMs }));
    }, timeoutMs);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

class ArcherEngine implements Archer {
  private currentState: ArcherState = 'created';
  private readonly lifecycle = new AbortController();
  private readonly registry = new AgentRegistry();
  private openedCamp: ResolvedDependency<Camp> | null = null;
  private applicationContext: ArcherContext | null = null;
  private releaseCamp?: () => void;
  private startPromise?: Promise<void>;
  private stopPromise?: Promise<void>;
  private cleanupPromise?: Promise<void>;
  private stopRequested = false;
  readonly agents: AgentManager = this.registry;
  constructor(private readonly options: ArcherOptions) {
    if (!options.camp) throw new ArcherError('INVALID_ARGUMENT', 'Camp is required.');
  }
  get state(): ArcherState { return this.currentState; }
  get context(): ArcherContext {
    if (this.currentState !== 'running' || !this.applicationContext) throw new ArcherError('ARCHER_NOT_RUNNING', 'Archer is not running.');
    return this.applicationContext;
  }
  get camp(): Camp {
    if (!this.openedCamp) throw new ArcherError('ARCHER_NOT_RUNNING', 'Camp is not available.');
    return this.openedCamp.value;
  }
  private reportError = (error: ArcherError): void => { try { this.options.onError?.(error); } catch { /* 诊断不能影响执行。 */ } };
  start(): Promise<void> {
    if (this.currentState === 'running') return Promise.resolve();
    if (this.startPromise && this.currentState === 'starting') return this.startPromise;
    if (this.currentState !== 'created') return Promise.reject(new ArcherError('ARCHER_FAILED', 'Archer cannot be restarted.'));
    this.currentState = 'starting';
    return this.startPromise = this.doStart();
  }
  private async doStart(): Promise<void> {
    try {
      this.openedCamp = await openDependency(this.options.camp, this.lifecycle.signal, 'Camp');
      this.releaseCamp = this.camp.acquire();
      if (this.stopRequested) throw new ArcherError('ABORTED', 'Startup was stopped.');
      this.applicationContext = createArcherContext({ camp: this.camp, journal: this.options.journal,
        inference: this.options.inference, clock: this.options.clock, configure: this.options.configureContext });
      this.registry.attach({ journal: this.applicationContext.resolve(ARCHER_JOURNAL), camp: this.camp,
        inference: this.applicationContext.resolve(ARCHER_INFERENCE), preparations: this.options.preparations ?? [],
        clock: this.applicationContext.resolve(ARCHER_CLOCK), onError: this.reportError, onEffectExecuted: this.options.onEffectExecuted });
      await this.registry.load();
      this.registry.activateAll();
      for (const runtime of this.registry.runtimes()) {
        if (this.stopRequested) break;
        try { await runtime.recover(this.lifecycle.signal); }
        catch (error) { if (!this.stopRequested) this.reportError(error instanceof ArcherError ? error : new ArcherError('INTERNAL', String(error))); }
      }
      if (this.stopRequested) throw new ArcherError('ABORTED', 'Startup was stopped.');
      this.currentState = 'running';
    } catch (error) {
      this.lifecycle.abort();
      let cleanup: unknown;
      try { await this.cleanup(); } catch (failure) { cleanup = failure; }
      this.currentState = 'failed';
      if (error instanceof ArcherError && !cleanup) throw error;
      throw new ArcherError('ARCHER_FAILED', 'Archer startup failed.', { cause: String(error), ...(cleanup ? { cleanup: String(cleanup) } : {}) });
    }
  }
  stop(options: StopOptions = {}): Promise<void> {
    const timeoutMs = validateTimeout(options);
    if (this.currentState === 'stopped') return Promise.resolve();
    if (this.currentState === 'created') { this.currentState = 'stopped'; return Promise.resolve(); }
    if (!this.stopPromise) {
      this.stopRequested = true;
      if (this.currentState === 'starting') this.lifecycle.abort();
      this.stopPromise = this.doStop();
    }
    return raceTimeout(this.stopPromise, timeoutMs).then(() => { this.currentState = 'stopped'; }, error => { this.currentState = 'failed'; throw error; });
  }
  private async doStop(): Promise<void> {
    await this.startPromise?.catch(() => undefined);
    this.currentState = 'stopping';
    await this.cleanup();
  }
  private cleanup(): Promise<void> { return this.cleanupPromise ??= this.releaseResources(); }
  private async releaseResources(): Promise<void> {
    this.registry.deactivateAll();
    const failures: string[] = [];
    for (const result of await Promise.allSettled(this.registry.runtimes().map(runtime => runtime.shutdown()))) {
      if (result.status === 'rejected') failures.push(String(result.reason));
    }
    try { await this.applicationContext?.dispose(); } catch (error) { failures.push(String(error)); }
    this.releaseCamp?.(); this.releaseCamp = undefined;
    try { await this.openedCamp?.close(); } catch (error) { failures.push(String(error)); }
    this.openedCamp = null;
    if (failures.length) throw new ArcherError('INTERNAL', 'Archer cleanup failed.', { failures });
  }
}
/** 构造不执行 I/O；owned Camp 在 start 时打开。 */
export function createArcher(options: ArcherOptions): Archer { return new ArcherEngine(options); }
