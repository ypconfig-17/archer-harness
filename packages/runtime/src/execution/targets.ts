/** 将已提交能力引用解析为本次操作，不按名称选择替代实现。 */
import { TOOL, SKILL } from '@archer/camp';
import { ArcherError, SkillContentSchema, SKILL_CONTENT_MAX_BYTES } from '@archer/contracts';
import type { Camp, CallEffect, OperationContext, JsonValue, ToolMetadata } from '@archer/contracts';
import type { EffectTarget } from '@archer/handler';
export function resolveCall(camp: Camp, effect: CallEffect): EffectTarget {
  const ref = effect.target;
  if (ref.contractId === TOOL.id) {
    const implementation = camp.resolve(ref, TOOL);
    const descriptor = camp.list(TOOL).find(item => item.ref.providerId === ref.providerId && item.ref.capabilityId === ref.capabilityId)!;
    return { ref, metadata: descriptor.metadata, invoke: implementation.invoke };
  }
  if (ref.contractId === SKILL.id) {
    const implementation = camp.resolve(ref, SKILL);
    const descriptor = camp.list(SKILL).find(item => item.ref.providerId === ref.providerId && item.ref.capabilityId === ref.capabilityId)!;
    const metadata: ToolMetadata = { description: descriptor.metadata.description, inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execution: 'read' };
    return { ref, metadata, invoke: async (_input: JsonValue, context: OperationContext) => {
      const value = SkillContentSchema.parse(await implementation.load(context));
      if (new TextEncoder().encode(JSON.stringify(value)).length > SKILL_CONTENT_MAX_BYTES) throw new Error('Skill content exceeds 64 KiB.');
      return value;
    } };
  }
  throw new ArcherError('INVALID_ARGUMENT', 'CALL only supports tool invocation or skill loading.');
}
