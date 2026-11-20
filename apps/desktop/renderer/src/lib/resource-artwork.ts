/** 图标映射仅为本地展示词汇，不影响 Camp 解析、权限、来源身份或执行策略。 */
import type { CapabilityDescriptor } from '@archer/contracts';

type Tile = readonly [number, number];
const SOURCES: Record<string, Tile> = {
  files: [0, 0], shell: [1, 0], history: [4, 0], project: [5, 0],
  skills: [3, 0], journal: [6, 0], inference: [7, 0],
};
const SKILLS: Record<string, Tile> = {
  'dingtalk-aisearch': [2, 0], 'dingtalk-aitable': [0, 1],
  'dingtalk-calendar': [1, 1], 'dingtalk-chat': [2, 1],
  'dingtalk-contact': [3, 1], 'dingtalk-mail': [4, 1],
  'dingtalk-doc': [0, 2], 'dingtalk-drive': [2, 3],
  'dingtalk-wiki': [3, 0], 'dingtalk-todo': [6, 0],
  'dingtalk-minutes': [0, 2], 'dingtalk-event': [4, 3],
};

export function resourceArtwork(providerId: string, capability?: CapabilityDescriptor): Tile {
  if (!capability) return SOURCES[providerId] ?? [7, 2];
  if (capability.ref.contractId === 'archer.skill@1') {
    const name = typeof capability.metadata.name === 'string'
      ? capability.metadata.name : capability.ref.capabilityId;
    return SKILLS[name] ?? [3, 0];
  }
  if (providerId === 'files') {
    return ['glob', 'grep'].includes(capability.ref.capabilityId) ? [2, 0] : [0, 0];
  }
  return SOURCES[providerId] ?? [7, 2];
}
