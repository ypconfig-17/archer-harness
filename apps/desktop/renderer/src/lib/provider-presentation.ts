/** Provider 只读展示的共用契约标签；不按来源名称猜测能力。 */
import type { CapabilityDescriptor } from '@archer/contracts';
import type { IconName } from '@archer/ui';

const CONTRACTS: Record<string, { label: string; icon: IconName; purpose: string }> = {
  'archer.tool@1': { label: '工具', icon: 'terminal', purpose: '执行具体操作' },
  'archer.skill@1': { label: '技能', icon: 'file', purpose: '按需加载知识与指引' },
  'archer.inference@1': { label: '推理', icon: 'spark', purpose: '提供模型推理' },
  'archer.journal@1': { label: '日志', icon: 'drive', purpose: '保存已提交的执行事实' },
  'archer.inference.prepare@1': { label: '推理准备', icon: 'folder', purpose: '提供当次推理参考' },
};

export function contractInfo(id: string) {
  return CONTRACTS[id] ?? { label: id, icon: 'panel' as const, purpose: '自定义契约能力' };
}

/**
 * 界面说明只取宿主可读文字：工具用作者提供的 summary，其他契约的 description 本身就是展示文案。
 * 工具的 description 是模型声明正文，不在这里展开。
 */
export function summaryOf(capability: CapabilityDescriptor): string | undefined {
  const { ref, metadata } = capability;
  if (typeof metadata.summary === 'string') return metadata.summary;
  if (ref.contractId === 'archer.tool@1') return undefined;
  return typeof metadata.description === 'string' ? metadata.description : undefined;
}

