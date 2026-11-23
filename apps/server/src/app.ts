/**
 * Archer Harness — Fastify 应用装配
 *
 * Server 只做协议适配：鉴权、SSE、错误映射；不实现 Agent 调度。
 */

import type { SkillLibrary } from './skill-library.js';
import type { RecoveryRecords } from './recovery-records.js';
import { z } from 'zod';
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import cors from '@fastify/cors';
import { ModelSettingsUpdateSchema, ArcherError } from '@archer/contracts';
import type { ModelSettingsService } from './model-settings.js';
import type { Archer, HealthInfo } from '@archer/contracts';
import { createAuthHook } from './auth.js';
import { registerErrorHandler } from './error-handler.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerEventsSseRoute } from './routes/events-sse.js';
import { registerHealthRoute } from './routes/health.js';
import { registerSkillRoutes } from './routes/skills.js';
import { registerWorkspaceGitRoute } from './routes/workspace-git.js';

export interface ServerOptions {
  archer: Archer;
  modelSettings?: ModelSettingsService;
  skillLibrary?: SkillLibrary;
  /** 当前推理实现，供健康检查展示 */
  inference: HealthInfo['inference'];
  /** 启动恢复诊断，不参与会话事实或调度。 */
  recoveryRecords?: RecoveryRecords;
  token?: string;
  logger?: FastifyServerOptions['logger'];
}

export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 30 * 1024 * 1024, logger: options.logger ?? false });

  await app.register(cors, { origin: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'] });
  registerErrorHandler(app);

  registerHealthRoute(app, {
    inference: () => options.modelSettings?.get().mode ?? options.inference,
    recoveryFailures: options.recoveryRecords ? () => options.recoveryRecords!.list().length : undefined,
  });

  const auth = createAuthHook(options.token);
  app.get('/api/recovery-records', { preHandler: auth }, async () => options.recoveryRecords?.list() ?? []);
  const recoveryRecord = (params: unknown) => {
    if (!options.recoveryRecords) throw new ArcherError('INVALID_ARGUMENT', '当前入口未装配异常日志管理');
    return { records: options.recoveryRecords, agentId: z.object({ agentId: z.string() }).parse(params).agentId };
  };
  app.get('/api/recovery-records/:agentId/export', { preHandler: auth }, async request => {
    const { records, agentId } = recoveryRecord(request.params);
    return records.export(agentId);
  });
  app.delete('/api/recovery-records/:agentId', { preHandler: auth }, async (request, reply) => {
    const { records, agentId } = recoveryRecord(request.params);
    await records.isolate(agentId);
    return reply.code(204).send();
  });
  app.get('/api/settings/models', { preHandler: auth }, async () => {
    if (!options.modelSettings) throw new ArcherError('INVALID_ARGUMENT', '当前入口没有装配模型设置服务');
    return options.modelSettings.get();
  });
  app.put('/api/settings/models', { preHandler: auth }, async request => {
    if (!options.modelSettings) throw new ArcherError('INVALID_ARGUMENT', '当前入口没有装配模型设置服务');
    return options.modelSettings.update(ModelSettingsUpdateSchema.parse(request.body));
  });
  app.get('/api/providers', { preHandler: auth }, async () => options.archer.camp.providers());
  registerSkillRoutes(app, { archer: options.archer, auth, library: options.skillLibrary });
  registerWorkspaceGitRoute(app, { archer: options.archer, auth });
  registerAgentRoutes(app, { archer: options.archer, auth });
  registerEventsSseRoute(app, { archer: options.archer, auth });

  return app;
}
