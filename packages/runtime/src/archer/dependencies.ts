/**
 * Archer Harness — 依赖装配
 *
 * 直接传入实例表示借用；open 工厂返回的 Opened 由容器拥有并逆序关闭。
 */

import type { Dependency, Opened } from '@archer/contracts';
import { ArcherError } from '@archer/contracts';

export function isOwnedDependency<T>(dependency: Dependency<T>): dependency is {
  open(context: { readonly signal: AbortSignal }): Promise<Opened<T>>;
} {
  return (
    typeof dependency === 'object'
    && dependency !== null
    && typeof (dependency as { open?: unknown }).open === 'function'
  );
}

export interface ResolvedDependency<T> {
  value: T;
  close(): Promise<void>;
}

export async function openDependency<T>(
  dependency: Dependency<T>,
  signal: AbortSignal,
  label: string,
): Promise<ResolvedDependency<T>> {
  if (!isOwnedDependency(dependency)) {
    return { value: dependency, close: async () => undefined };
  }
  let opened: Opened<T>;
  try {
    opened = await dependency.open({ signal });
  } catch (error: unknown) {
    throw new ArcherError(
      'ARCHER_FAILED',
      `打开${label}依赖失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let closing: Promise<void> | undefined;
  return {
    value: opened.value,
    close: () => closing ??= Promise.resolve().then(() => opened.close()),
  };
}
