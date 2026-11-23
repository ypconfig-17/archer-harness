/** 以完整引用固定选择，刷新后不把旧能力静默替换为新 revision。 */
import type { CapabilityDescriptor, ProviderInfo } from '@archer/contracts';
import { contractInfo, summaryOf } from './provider-presentation';

export function capabilityKey(capability: CapabilityDescriptor): string {
  const ref = capability.ref;
  return JSON.stringify([ref.providerId, ref.capabilityId, ref.contractId, ref.revision]);
}

export function providerDescription(source: ProviderInfo): string {
  if (typeof source.identity.description === 'string' && source.identity.description.trim()) return source.identity.description;
  const summaries = [...new Set(source.capabilities.map(summaryOf).filter((text): text is string => Boolean(text)))];
  if (summaries.length) return summaries.slice(0, 2).join('；');
  return [...new Set(source.capabilities.map(item => contractInfo(item.ref.contractId).purpose))].join('；') || '尚无公开能力声明';
}

export function searchProviders(sources: readonly ProviderInfo[], query: string) {
  const term = query.trim().toLocaleLowerCase();
  return sources.map(source => {
    const sourceMatches = [source.id, source.identity.name, source.identity.description]
      .some(value => typeof value === 'string' && value.toLocaleLowerCase().includes(term));
    const capabilities = source.capabilities.filter(item => sourceMatches || [
      item.ref.capabilityId, item.ref.contractId, item.metadata.name,
      summaryOf(item), item.metadata.description, contractInfo(item.ref.contractId).label,
    ].some(value => typeof value === 'string' && value.toLocaleLowerCase().includes(term)));
    return { source, capabilities };
  }).filter(item => !term || item.capabilities.length || item.source.id.toLocaleLowerCase().includes(term));
}

/** 结构化视图只解释当前层字段；组合、引用和约束仍以原始 Schema 为准。 */
export function schemaFields(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const schema = value as Record<string, unknown>;
  if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) return [];
  const required = Array.isArray(schema.required) ? schema.required : [];
  return Object.entries(schema.properties).map(([name, value]) => {
    const field = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return {
      name,
      type: typeof field.type === 'string' ? field.type : Array.isArray(field.type) ? field.type.join(' / ') : '见原始 Schema',
      required: required.includes(name),
      description: typeof field.description === 'string' ? field.description : '未声明说明',
    };
  });
}
