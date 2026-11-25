/**
 * Archer Harness — Camp 受限能力视图裁剪
 *
 * 从已有 Camp 派生只读或受限子集视图，用于子 Agent 或低权限场景的硬隔离：
 * 不仅在 list/providers 中隐藏能力，还在 resolve 边界拦截越权引用。
 */

import { ArcherError } from '@archer/contracts';
import type {
  Camp,
  CapabilityDescriptor,
  CapabilityRef,
  Contract,
  ProviderInfo,
  ToolMetadata,
} from '@archer/contracts';

export interface CampScopePolicy {
  /** 仅允许指定的 Provider ID；省略则不按 Provider 过滤 */
  allowProviders?: readonly string[];
  /** 仅允许指定的能力键（格式：`providerId:capabilityId`） */
  allowCapabilities?: readonly string[];
  /** 显式禁止的能力键（格式：`providerId:capabilityId`） */
  denyCapabilities?: readonly string[];
  /** 仅保留只读且非人工交互的 Tool（`execution === 'read' && !interaction`） */
  readOnlyTools?: boolean;
  /** 是否隐藏所有 Skill 能力 */
  hideSkills?: boolean;
}

function capabilityKey(ref: Pick<CapabilityRef, 'providerId' | 'capabilityId'>): string {
  return `${ref.providerId}:${ref.capabilityId}`;
}

function isDescriptorAllowed(
  descriptor: Pick<CapabilityDescriptor, 'ref' | 'metadata'>,
  policy: CampScopePolicy,
  allowProviders: ReadonlySet<string> | null,
  allowCapabilities: ReadonlySet<string> | null,
  denyCapabilities: ReadonlySet<string>,
): boolean {
  const { ref, metadata } = descriptor;
  if (allowProviders && !allowProviders.has(ref.providerId)) return false;
  const key = capabilityKey(ref);
  if (denyCapabilities.has(key)) return false;
  if (allowCapabilities && !allowCapabilities.has(key)) return false;

  if (policy.hideSkills && ref.contractId === 'archer.skill@1') {
    return false;
  }
  if (policy.readOnlyTools && ref.contractId === 'archer.tool@1') {
    const toolMeta = metadata as Partial<ToolMetadata>;
    if (toolMeta.execution !== 'read' || toolMeta.interaction === 'human') {
      return false;
    }
  }
  return true;
}

/**
 * 基于父 Camp 创建一个受限只读视图：
 * - 不拥有父容器资源，close() 为空操作；
 * - 借用计数（acquire）直接透传给父 Camp，保护底层共享资源生命周期；
 * - 拒绝 refreshProvider，防止低权限视图篡改父容器声明。
 */
export function scopeCamp(parent: Camp, policy: CampScopePolicy): Camp {
  const allowProviders = policy.allowProviders ? new Set(policy.allowProviders) : null;
  const allowCapabilities = policy.allowCapabilities ? new Set(policy.allowCapabilities) : null;
  const denyCapabilities = new Set(policy.denyCapabilities ?? []);

  const allowed = (descriptor: Pick<CapabilityDescriptor, 'ref' | 'metadata'>): boolean =>
    isDescriptorAllowed(descriptor, policy, allowProviders, allowCapabilities, denyCapabilities);

  const findDescriptor = (ref: CapabilityRef): CapabilityDescriptor | undefined => {
    for (const info of parent.providers()) {
      if (info.id !== ref.providerId) continue;
      for (const cap of info.capabilities) {
        if (
          cap.ref.capabilityId === ref.capabilityId &&
          cap.ref.contractId === ref.contractId &&
          cap.ref.revision === ref.revision
        ) {
          return cap;
        }
      }
    }
    return undefined;
  };

  return {
    get signal() {
      return parent.signal;
    },
    providers(): readonly ProviderInfo[] {
      const result: ProviderInfo[] = [];
      for (const info of parent.providers()) {
        if (allowProviders && !allowProviders.has(info.id)) continue;
        const capabilities = info.capabilities.filter((cap) => allowed(cap));
        if (capabilities.length === 0) continue;
        result.push({
          id: info.id,
          identity: info.identity,
          capabilities,
        });
      }
      return result;
    },
    list<I, M extends object>(contract: Contract<I, M>) {
      return parent
        .list(contract)
        .filter((entry) =>
          allowed({
            ref: entry.ref,
            metadata: entry.metadata as unknown as CapabilityDescriptor['metadata'],
          }),
        );
    },
    resolve<I, M extends object>(ref: CapabilityRef, contract: Contract<I, M>): I {
      const descriptor = findDescriptor(ref);
      if (!descriptor || !allowed(descriptor)) {
        throw new ArcherError('CAPABILITY_UNAVAILABLE', 'Capability is outside the scoped Camp view.', {
          providerId: ref.providerId,
          capabilityId: ref.capabilityId,
        });
      }
      return parent.resolve(ref, contract);
    },
    acquire() {
      return parent.acquire();
    },
    async refreshProvider() {
      throw new ArcherError('PERMISSION_DENIED', 'Scoped Camp view cannot refresh parent providers.');
    },
    async close() {
      // 借用视图不拥有父容器资源，关闭父容器由宿主负责。
    },
  };
}
