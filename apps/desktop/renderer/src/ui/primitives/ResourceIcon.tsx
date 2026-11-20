/** 用户提供的图标原图按图集窗口显示，不重绘资源，不把装饰分类当作能力事实。 */
import type { CSSProperties } from 'react';
import type { CapabilityDescriptor } from '@archer/contracts';
import { resourceArtwork } from '../../lib/resource-artwork';

export function ResourceIcon({ providerId, capability }: { providerId: string; capability?: CapabilityDescriptor }) {
  const [column, row] = resourceArtwork(providerId, capability);
  return <span className="resource-artwork" aria-hidden="true" style={{
    '--artwork-column': column,
    '--artwork-row': row,
  } as CSSProperties} />;
}
