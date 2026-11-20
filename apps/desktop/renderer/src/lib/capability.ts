/** 人类可读的能力名称，不作为持久化身份或模型工具名称。 */
import type { CapabilityRef } from '@archer/contracts';

export function capabilityLabel(ref: CapabilityRef): string {
  return `${ref.providerId}.${ref.capabilityId}`;
}
