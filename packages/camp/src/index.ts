/** Camp 只管理 Provider 声明、稳定引用和共享资源，不解释 Agent 或 Effect。 */
import { z } from 'zod';
import { ArcherError, assertJsonValue, canonicalJson, JsonObjectSchema, JsonValueSchema, SkillResourceSchema } from '@archer/contracts';
import type { Camp, Contract, Contribution, Provider, ProviderDefinition, CapabilityRef, CapabilityDescriptor, JsonObject,
  Tool, ToolMetadata, Skill, SkillMetadata, Inference, AgentJournal, InferencePrepare, PrepareMetadata } from '@archer/contracts';
export type { Camp, Contract, Contribution, Provider, ProviderDefinition, CapabilityRef } from '@archer/contracts';

export function contract<I, M extends object>(id: string, metadata: z.ZodType<M>, methods: readonly (keyof I & string)[], optionalMethods: readonly (keyof I & string)[] = []): Contract<I, M> {
  validateContract({ id, metadata, methods, optionalMethods });
  return Object.freeze({ id, metadata, methods: Object.freeze([...methods]), optionalMethods: Object.freeze([...optionalMethods]) });
}
function validateContract(type: Contract<any, any>): void {
  if (!type || !/^[A-Za-z][A-Za-z0-9._-]*@[1-9][0-9]*$/.test(type.id)
    || typeof type.metadata?.parse !== 'function' || !Array.isArray(type.methods) || !type.methods.length
    || (type.optionalMethods !== undefined && !Array.isArray(type.optionalMethods))
    || new Set([...type.methods, ...(type.optionalMethods ?? [])]).size !== type.methods.length + (type.optionalMethods?.length ?? 0)
    || [...type.methods, ...(type.optionalMethods ?? [])].some(method => typeof method !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(method))) {
    throw new Error('Invalid contract declaration.');
  }
}
export const TOOL = contract<Tool, ToolMetadata>('archer.tool@1', z.object({
  description: z.string().min(1), summary: z.string().min(1).optional(), inputSchema: JsonObjectSchema, execution: z.enum(['read', 'write', 'shell']),
  interaction: z.literal('human').optional(), resultView: z.literal('output').optional(),
}).strict(), ['invoke']);
export const SKILL = contract<Skill, SkillMetadata>('archer.skill@1', z.object({
  name: z.string().min(1), description: z.string().min(1),
  source: z.string().min(1).optional(), path: z.string().min(1).optional(),
  resources: z.array(SkillResourceSchema).optional(), resourcesTruncated: z.boolean().optional(),
}).strict(), ['load']);
export const INFERENCE = contract<Inference, { description: string }>('archer.inference@1', z.object({ description: z.string() }).strict(), ['infer'], ['measure']);
export const JOURNAL = contract<AgentJournal, { description: string }>('archer.journal@1', z.object({ description: z.string() }).strict(), ['ids', 'read', 'append']);
export const INFERENCE_PREPARE = contract<InferencePrepare, PrepareMetadata>('archer.inference.prepare@1', z.object({ description: z.string(), input: JsonValueSchema, order: z.number().finite().optional() }).strict(), ['prepare']);

export function offer<I, M extends object>(type: Contract<I, M>, metadata: M, implementation: I): Contribution<I, M> {
  return { contract: type, metadata: type.metadata.parse(metadata), implementation };
}
export function tool(input: ToolMetadata & Tool): Contribution<Tool, ToolMetadata> {
  const { invoke, ...metadata } = input;
  return offer(TOOL, metadata, { invoke });
}
export function skill(input: SkillMetadata & Skill): Contribution<Skill, SkillMetadata> {
  const { load, ...metadata } = input;
  return offer(SKILL, metadata, { load });
}
export function provider(id: string, capabilities: Provider['capabilities'], options: Omit<Provider, 'id' | 'capabilities' | 'identity'> & { identity?: JsonObject } = {}): Provider {
  return { ...options, id, identity: options.identity ?? { provider: id }, capabilities };
}

/** 所有声明先校验，随后按顺序初始化；只释放成功交付的资源。 */
export async function createCamp(options: {
  providers: readonly (Provider | ProviderDefinition)[];
  signal?: AbortSignal;
}): Promise<Camp> {
  const definitions = new Map<string, ProviderDefinition>();
  const initial: Provider[] = [];
  const seen = new Set<string>();
  const creationSignal = options.signal ?? new AbortController().signal;
  // 先检查定义身份，避免重复定义触发不必要的工厂执行。
  for (const input of options.providers) {
    if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(input.id) || seen.has(input.id)) {
      throw new Error(`Invalid or duplicate provider: ${input.id}`);
    }
    seen.add(input.id);
  }
  for (const input of options.providers) {
    creationSignal.throwIfAborted();
    if ('create' in input) {
      definitions.set(input.id, { id: input.id, create: input.create.bind(input) });
      const source = await input.create({ signal: creationSignal });
      if (source.id !== input.id) throw new Error('Provider factory returned a different ID.');
      initial.push(source);
    } else {
      initial.push(input);
    }
  }
  return createProviderCamp({ providers: initial, signal: options.signal }, definitions);
}

/** 初始装配与刷新共用同一套契约校验、引用生成及资源初始化规则。 */
async function createProviderCamp(
  options: { providers: readonly Provider[]; signal?: AbortSignal },
  definitions: ReadonlyMap<string, ProviderDefinition> = new Map(),
): Promise<Camp> {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const sources = options.providers.map(source => ({ ...source, open: source.open?.bind(source), close: source.close?.bind(source), identity: JsonObjectSchema.parse(source.identity), capabilities: { ...source.capabilities } }));
  const entries = new Map<string, { descriptor: CapabilityDescriptor; implementation: unknown }>();
  const pending: { providerId: string; capabilityId: string; contractId: string; metadata: JsonObject; implementation: unknown; source: string }[] = [];
  const ids = new Set<string>();
  const key = (ref: Pick<CapabilityRef, 'providerId' | 'capabilityId'>) => `${ref.providerId}:${ref.capabilityId}`;
  for (const source of sources) {
    if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(source.id) || ids.has(source.id)) throw new Error(`Invalid or duplicate provider: ${source.id}`);
    ids.add(source.id); assertJsonValue(source.identity, 'Provider identity');
    for (const [id, contribution] of Object.entries(source.capabilities)) {
      if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(id)) throw new Error(`Invalid capability ID: ${id}`);
      const type = contribution.contract;
      validateContract(type);
      const metadata = type.metadata.parse(contribution.metadata);
      assertJsonValue(metadata, 'Capability metadata');
      const bound: Record<string, unknown> = {};
      for (const method of [...type.methods, ...(type.optionalMethods ?? [])]) {
        const fn = contribution.implementation?.[method];
        if (fn === undefined && type.optionalMethods?.includes(method)) continue;
        if (typeof fn !== 'function') throw new Error(`Contract ${type.id} requires ${method}.`);
        bound[method] = fn.bind(contribution.implementation);
      }
      pending.push({ providerId: source.id, capabilityId: id, contractId: type.id,
        metadata: JsonObjectSchema.parse(metadata), implementation: Object.freeze(bound),
        source: canonicalJson({ identity: source.identity, contractId: type.id, metadata }) });
    }
  }
  // 首次异步等待前固定全部声明和方法，调用方之后的修改不改变已接入来源。
  for (const item of pending) {
    const bytes = new TextEncoder().encode(item.source);
    const revision = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
    const ref = { providerId: item.providerId, capabilityId: item.capabilityId, contractId: item.contractId, revision };
    entries.set(key(ref), { descriptor: { ref, metadata: item.metadata }, implementation: item.implementation });
  }
  const opened: Provider[] = [];
  try {
    for (const source of sources) {
      if (signal.aborted) throw signal.reason;
      await source.open?.({ signal });
      opened.push(source);
    }
    if (signal.aborted) throw signal.reason;
  } catch (error) {
    const failures: unknown[] = [error];
    for (const source of opened.reverse()) try { await source.close?.(); } catch (failure) { failures.push(failure); }
    controller.abort();
    throw new AggregateError(failures, 'Camp initialization failed.');
  }
  const replacements = new Map<string, Camp>();
  const retired: Camp[] = [];
  let refreshTail: Promise<void> = Promise.resolve();
  const refreshFailures: unknown[] = [];
  const retiredInitial = new Set<string>();
  const closedInitial = new Set<string>();
  let retirementTail: Promise<void> = Promise.resolve();
  // 借用按整个 Camp 计数，宁可延后释放，也不提前关闭仍可能被使用的资源。
  const retireUnused = () => {
    if (users) return;
    const children = retired.splice(0);
    const initial = opened.filter(source => retiredInitial.has(source.id) && !closedInitial.has(source.id));
    for (const source of initial) closedInitial.add(source.id);
    retirementTail = retirementTail.then(async () => {
      for (const child of children) {
        try { await child.close(); } catch (error) { refreshFailures.push(error); }
      }
      for (const source of initial) {
        try { await source.close?.(); } catch (error) { refreshFailures.push(error); }
      }
    });
  };
  let state: 'active' | 'closing' | 'closed' = 'active';
  let users = 0;
  let drained: (() => void) | undefined;
  let closing: Promise<void> | undefined;
  const check = () => { if (state !== 'active' || signal.aborted) throw new ArcherError('ARCHER_FAILED', 'Camp is unavailable.'); };
  return {
    signal,
    providers() {
      check();
      return sources.map(source => {
        const replacement = replacements.get(source.id);
        if (replacement) return replacement.providers()[0]!;
        return {
          id: source.id,
          identity: JsonObjectSchema.parse(source.identity),
          capabilities: [...entries.values()]
            .filter(entry => entry.descriptor.ref.providerId === source.id)
            .map(entry => structuredClone(entry.descriptor)),
        };
      });
    },
    list(type) {
      check();
      // 保留宿主装配顺序，刷新不会把某个 Provider 移到列表末尾。
      return sources.flatMap(source => {
        const replacement = replacements.get(source.id);
        if (replacement) return [...replacement.list(type)];
        return [...entries.values()]
          .filter(entry => entry.descriptor.ref.providerId === source.id
            && entry.descriptor.ref.contractId === type.id)
          .map(entry => ({
            ref: structuredClone(entry.descriptor.ref),
            metadata: type.metadata.parse(structuredClone(entry.descriptor.metadata)),
          }));
      });
    },
    resolve(ref, type) {
      check();
      const replacement = replacements.get(ref.providerId);
      if (replacement) {
        try { return replacement.resolve(ref, type); }
        catch (error) {
          if (!(error instanceof ArcherError) || error.code !== 'CAPABILITY_UNAVAILABLE') throw error;
        }
        // 只有仍有既有借用时才允许解析旧引用，不把退役实例重新提供给新声明。
        if (users) {
          for (const previous of [...retired].reverse()) {
            try { return previous.resolve(ref, type); }
            catch (error) {
              if (!(error instanceof ArcherError) || error.code !== 'CAPABILITY_UNAVAILABLE') throw error;
            }
          }
        }
      }
      const entry = !closedInitial.has(ref.providerId) && (!replacement || users) ? entries.get(key(ref)) : undefined;
      if (!entry || ref.contractId !== type.id || entry.descriptor.ref.contractId !== type.id || entry.descriptor.ref.revision !== ref.revision) {
        throw new ArcherError('CAPABILITY_UNAVAILABLE', 'Original provider capability is unavailable.', { providerId: ref.providerId, capabilityId: ref.capabilityId });
      }
      type.metadata.parse(entry.descriptor.metadata);
      for (const method of type.methods) if (typeof (entry.implementation as Record<string, unknown>)[method] !== 'function') throw new Error('Contract interface is incompatible.');
      return entry.implementation as never;
    },
    refreshProvider(providerId) {
      const operation = refreshTail.then(async () => {
        check();
        const definition = definitions.get(providerId);
        if (!definition) throw new ArcherError('INVALID_ARGUMENT', 'Provider has no creation definition.');
        const source = await definition.create({ signal });
        if (source.id !== providerId) throw new Error('Provider factory returned a different ID.');
        const candidate = await createProviderCamp({ providers: [source], signal });
        try {
          check();
        } catch (error) {
          await candidate.close();
          throw error;
        }
        // 发布无异步间隙；后续查询只看新声明，旧资源由已有借用保护。
        const previous = replacements.get(providerId);
        replacements.set(providerId, candidate);
        if (previous) retired.push(previous);
        else retiredInitial.add(providerId);
        retireUnused();
        await retirementTail;
      });
      // 失败不阻塞后续刷新，原调用仍收到真实错误。
      refreshTail = operation.catch(() => undefined);
      return operation;
    },
    acquire() {
      check();
      users++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        users--;
        if (!users) {
          retireUnused();
          drained?.();
        }
      };
    },
    close() {
      if (closing) return closing;
      state = 'closing';
      closing = Promise.resolve().then(async () => {
        if (users) await new Promise<void>(resolve => { drained = resolve; });
        await refreshTail;
        await retirementTail;
        const failures: unknown[] = [...refreshFailures];
        for (const child of [...replacements.values(), ...retired].reverse()) {
          try { await child.close(); } catch (error) { failures.push(error); }
        }
        controller.abort();
        for (const source of [...opened].reverse()) {
          if (closedInitial.has(source.id)) continue;
          try { await source.close?.(); } catch (error) { failures.push(error); }
        }
        state = 'closed';
        if (failures.length) throw new AggregateError(failures, 'Provider cleanup failed.');
      });
      return closing;
    },
  };
}
