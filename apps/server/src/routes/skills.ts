/**
 * Archer Harness — 技能只读预览
 *
 * 只按已注册的固定引用读取正文或资源；不产生 Agent Effect，也不写任何事实。
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ArcherError } from '@archer/contracts';
import type { Archer } from '@archer/contracts';
import { SKILL, TOOL } from '@archer/camp';
import { SKILL_READ_CAPABILITY_ID } from '@archer/skills';
import type { SkillLibrary } from '../skill-library.js';
import type { AuthHook } from '../auth.js';

const RefParams = z.object({
  providerId: z.string().min(1),
  capabilityId: z.string().min(1),
  revision: z.string().min(1),
});
const ResourceQuery = z.object({ path: z.string().min(1) });

export interface SkillRoutesOptions {
  archer: Archer;
  auth: AuthHook;
  library?: SkillLibrary;
}

function registered(camp: Archer['camp'], params: z.infer<typeof RefParams>) {
  const entry = camp.list(SKILL).find(item => item.ref.providerId === params.providerId
    && item.ref.capabilityId === params.capabilityId && item.ref.revision === params.revision);
  if (!entry) throw new ArcherError('NOT_FOUND', '该技能声明已变化或不再注册，请刷新能力来源。');
  return entry;
}

export function registerSkillRoutes(app: FastifyInstance, options: SkillRoutesOptions): void {
  app.get('/api/skills/library', { preHandler: options.auth }, async () => ({ canAdd: !!options.library }));
  app.post('/api/skills/library', { preHandler: options.auth }, async request => {
    if (!options.library) throw new ArcherError('INVALID_ARGUMENT', '当前宿主未启用技能管理。');
    const input = z.object({ content: z.string().min(1) }).strict().parse(request.body);
    return options.library.add(input.content);
  });

  app.get('/api/skills/:providerId/:capabilityId/:revision', { preHandler: options.auth }, async request => {
    const params = RefParams.parse(request.params);
    const entry = registered(options.archer.camp, params);
    const value = await options.archer.camp.resolve(entry.ref, SKILL).load({ signal: options.archer.camp.signal });
    return { content: value.content, ...(value.revision === undefined ? {} : { revision: value.revision }) };
  });

  // 资源预览复用普通 Tool；来源未提供读取工具时明确不可用，不退化为静默空结果。
  app.get('/api/skills/:providerId/:capabilityId/:revision/resource', { preHandler: options.auth }, async request => {
    const params = RefParams.parse(request.params);
    const query = ResourceQuery.parse(request.query);
    registered(options.archer.camp, params);
    const reader = options.archer.camp.list(TOOL).find(item => item.ref.providerId === params.providerId
      && item.ref.capabilityId === SKILL_READ_CAPABILITY_ID);
    if (!reader) throw new ArcherError('NOT_FOUND', '该技能来源不支持资源预览。');
    const value = await options.archer.camp.resolve(reader.ref, TOOL)
      .invoke({ skill: params.capabilityId, path: query.path }, { signal: options.archer.camp.signal });
    const record = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
    if (typeof record?.output !== 'string' || typeof record.path !== 'string' || typeof record.revision !== 'string') {
      throw new ArcherError('INTERNAL', '技能资源读取返回了无法识别的结果。');
    }
    return { content: record.output, path: record.path, revision: record.revision };
  });
}