/** ArcherContext 从 Camp 解析基础设施；不拥有或重复初始化 Provider。 */
import { ArcherError } from '@archer/contracts';
import type { ArcherContext, ArcherContextOptions, Camp, Contract, CapabilityRef, AgentJournal } from '@archer/contracts';
import { JOURNAL, INFERENCE } from '@archer/camp';
import { createArcherContextBuilder, createServiceToken } from './context.js';
export const ARCHER_CAMP = createServiceToken<Camp>('archer.camp');
export const ARCHER_JOURNAL = createServiceToken<AgentJournal>('archer.journal');
export const ARCHER_INFERENCE = createServiceToken<CapabilityRef>('archer.inference');
export const ARCHER_CLOCK = createServiceToken<() => number>('archer.clock');

function selected<I, M extends object>(camp: Camp, type: Contract<I, M>, ref?: CapabilityRef): CapabilityRef {
  if (ref) { camp.resolve(ref, type); return ref; }
  const candidates = camp.list(type);
  if (candidates.length !== 1) throw new ArcherError('INVALID_ARGUMENT', `Contract ${type.id} requires one explicitly selected provider.`);
  return candidates[0]!.ref;
}
export function createArcherContext(options: ArcherContextOptions): ArcherContext {
  const journal = options.camp.resolve(selected(options.camp, JOURNAL, options.journal), JOURNAL);
  const inference = selected(options.camp, INFERENCE, options.inference);
  const builder = createArcherContextBuilder({ signal: options.camp.signal })
    .provideValue(ARCHER_CAMP, options.camp).provideValue(ARCHER_JOURNAL, journal)
    .provideValue(ARCHER_INFERENCE, inference).provideValue(ARCHER_CLOCK, options.clock ?? (() => Date.now()));
  options.configure?.(builder);
  return builder.build();
}
