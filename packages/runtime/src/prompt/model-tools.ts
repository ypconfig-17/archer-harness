/** Runtime 选择模型工具；Camp 只提供声明与实现，不决定模型策略。 */
import { TOOL, SKILL } from '@archer/camp';
import type { Camp, InferenceTool } from '@archer/contracts';
/** 模型名称仅用于本次声明的选择；执行身份由 target 保存，重名必须明确拒绝。 */
function nameFor(label: string): string {
  return label.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);
}
export function compileModelTools(camp: Camp): InferenceTool[] {
  const tools: InferenceTool[] = [];
  for (const item of camp.list(TOOL)) {
    const schema = structuredClone(item.metadata.inputSchema);
    const wrapped = schema.type !== 'object';
    tools.push({ name: nameFor(`${item.ref.providerId}_${item.ref.capabilityId}`), target: item.ref,
      description: item.metadata.description,
      parameters: wrapped ? { type: 'object', properties: { input: schema }, required: ['input'], additionalProperties: false } : schema,
      ...(wrapped ? { wrappedInput: true } : {}), ...(item.metadata.interaction ? { interaction: item.metadata.interaction } : {}), ...(item.metadata.execution === 'read' ? { readOnly: true } : {}) });
  }
  for (const item of camp.list(SKILL)) {
    // 技能描述通常自带句号；避免拼接出重复标点，同时保持与后句的边界。
    const description = item.metadata.description.trim();
    const sentence = /[.!?]$/.test(description) ? description : `${description}.`;
    tools.push({ name: nameFor(`load_${item.metadata.name}`), target: item.ref,
      description: `Load guidance for ${item.metadata.name}: ${sentence} Guidance grants no additional permissions.`,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      readOnly: true });
  }
  if (tools.length > 256) throw new Error('Model tool projection exceeds 256 tools; narrow the Archer provider composition.');
  if (new Set(tools.map(tool => tool.name)).size !== tools.length) throw new Error('Model tool name collision.');
  return tools;
}
