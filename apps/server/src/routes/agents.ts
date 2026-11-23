/**
 * Archer Harness — Agent / Turn 路由
 *
 * 只做请求解析、Agent 查找与错误映射；调度与提交由 Runtime 负责。
 */

import type { FastifyInstance } from 'fastify';
import {
  HumanTargetSchema,
  HumanReplySchema,
  ReconcileInputSchema,
  AbortAgentInputSchema,
  ArcherError,
  CreateAgentOptionsSchema,
  FollowUpAgentInputSchema,
  RenameAgentInputSchema,
  ConfigureExecutionSchema,
  SteerAgentInputSchema,
  SubmitAgentInputSchema,
  MAX_AGENT_EVENT_LIMIT,
  parseAfterSeqQuery,
  parseLimitQuery,
  type Agent,
  type Archer,
} from '@archer/contracts';
import type { AuthHook } from '../auth.js';

export interface AgentRoutesOptions {
  archer: Archer;
  auth: AuthHook;
}

function parseBeforeAgentSeq(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ArcherError('INVALID_ARGUMENT', 'beforeAgentSeq 必须为正整数');
  }
  return parsed;
}

function parseAfterSeq(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  return parseAfterSeqQuery(value);
}

function parseBeforeSeq(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ArcherError('INVALID_ARGUMENT', 'beforeSeq 必须为正整数');
  }
  return parsed;
}

export function registerAgentRoutes(
  app: FastifyInstance,
  options: AgentRoutesOptions,
): void {
  const { archer, auth } = options;

  const requireAgent = async (agentId: string): Promise<Agent> => {
    const agent = await archer.agents.get(agentId);
    if (!agent) {
      throw new ArcherError('NOT_FOUND', `Agent 不存在：${agentId}`, { agentId });
    }
    return agent;
  };

  app.get('/api/agents', { preHandler: auth }, async (request) => {
    const query = request.query as { afterId?: string; limit?: string };
    return archer.agents.list({
      ...(query.afterId ? { afterId: query.afterId } : {}),
      limit: parseLimitQuery(query.limit),
    });
  });

  app.post('/api/agents', { preHandler: auth }, async (request, reply) => {
    const input = CreateAgentOptionsSchema.parse(request.body);
    const agent = await archer.agents.create(input);
    return reply.code(201).send({ id: agent.id });
  });

  app.get('/api/agents/:agentId', { preHandler: auth }, async (request) => {
    const { agentId } = request.params as { agentId: string };
    const agent = await requireAgent(agentId);
    return agent.getState();
  });

  app.delete('/api/agents/:agentId', { preHandler: auth }, async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    await archer.agents.remove(agentId);
    return reply.code(204).send();
  });

  app.put('/api/agents/:agentId/title', { preHandler: auth }, async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    await archer.agents.rename(agentId, RenameAgentInputSchema.parse(request.body));
    return reply.code(204).send();
  });

  app.put('/api/agents/:agentId/execution', { preHandler: auth }, async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const input = ConfigureExecutionSchema.parse(request.body);
    await archer.agents.configureExecution(agentId, input);
    return reply.code(204).send();
  });


  app.post(
    '/api/agents/:agentId/queue/resume',
    { preHandler: auth },
    async (request, reply) => {
      const { agentId } = request.params as { agentId: string };
      await archer.agents.resumeQueue(agentId);
      return reply.code(204).send();
    },
  );

  app.post(
    '/api/agents/:agentId/queue/clear',
    { preHandler: auth },
    async (request, reply) => {
      const { agentId } = request.params as { agentId: string };
      await archer.agents.clearQueue(agentId);
      return reply.code(204).send();
    },
  );

  app.post('/api/agents/:agentId/human/token', { preHandler: auth }, async request => {
    const { agentId } = request.params as { agentId: string };
    return archer.agents.issueHumanToken(agentId, HumanTargetSchema.parse(request.body));
  });
  app.post('/api/agents/:agentId/human/reply', { preHandler: auth }, async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    await archer.agents.reply(agentId, HumanReplySchema.parse(request.body));
    return reply.code(204).send();
  });
  app.post('/api/agents/:agentId/reconcile', { preHandler: auth }, async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    await archer.agents.reconcile(agentId, ReconcileInputSchema.parse(request.body));
    return reply.code(204).send();
  });

  app.post('/api/agents/:agentId/prompt', { preHandler: auth }, async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const { input, ...commandOptions } = SubmitAgentInputSchema.parse(request.body);
    const agent = await requireAgent(agentId);
    await agent.prompt(input, commandOptions);
    return reply.code(204).send();
  });

  app.post('/api/agents/:agentId/send', { preHandler: auth }, async (request) => {
    const { agentId } = request.params as { agentId: string };
    const { input, ...commandOptions } = SubmitAgentInputSchema.parse(request.body);
    const agent = await requireAgent(agentId);
    return agent.send(input, commandOptions);
  });

  app.post('/api/agents/:agentId/steer', { preHandler: auth }, async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const { input, ...commandOptions } = SteerAgentInputSchema.parse(request.body);
    const agent = await requireAgent(agentId);
    await agent.steer(input, commandOptions);
    return reply.code(204).send();
  });

  app.post(
    '/api/agents/:agentId/follow-up',
    { preHandler: auth },
    async (request, reply) => {
      const { agentId } = request.params as { agentId: string };
      const { input, ...commandOptions } = FollowUpAgentInputSchema.parse(request.body);
      const agent = await requireAgent(agentId);
      await agent.followUp(input, commandOptions);
      return reply.code(204).send();
    },
  );

  app.post('/api/agents/:agentId/abort', { preHandler: auth }, async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const input = AbortAgentInputSchema.parse(request.body);
    const agent = await requireAgent(agentId);
    await agent.abort(input);
    return reply.code(204).send();
  });

  app.post(
    '/api/agents/:agentId/turns/:turnId/wait',
    { preHandler: auth },
    async (request, reply) => {
      const { agentId, turnId } = request.params as { agentId: string; turnId: string };
      const agent = await requireAgent(agentId);
      await agent.wait(turnId);
      return reply.code(204).send();
    },
  );

  app.get('/api/agents/:agentId/turns', { preHandler: auth }, async (request) => {
    const { agentId } = request.params as { agentId: string };
    const query = request.query as { beforeAgentSeq?: string; limit?: string };
    const agent = await requireAgent(agentId);
    const beforeAgentSeq = parseBeforeAgentSeq(query.beforeAgentSeq);
    return agent.turns.list({
      ...(beforeAgentSeq === undefined ? {} : { beforeAgentSeq }),
      limit: parseLimitQuery(query.limit),
    });
  });

  app.get(
    '/api/agents/:agentId/turns/by-request/:requestId',
    { preHandler: auth },
    async (request, reply) => {
      const { agentId, requestId } = request.params as {
        agentId: string;
        requestId: string;
      };
      const agent = await requireAgent(agentId);
      const turn = await agent.turns.findByRequestId(requestId);
      if (!turn) return reply.code(404).send({ error: `请求对应的 Turn 不存在：${requestId}` });
      return turn;
    },
  );

  app.get(
    '/api/agents/:agentId/turns/:turnId',
    { preHandler: auth },
    async (request, reply) => {
      const { agentId, turnId } = request.params as { agentId: string; turnId: string };
      const agent = await requireAgent(agentId);
      const turn = await agent.turns.get(turnId);
      if (!turn) return reply.code(404).send({ error: `Turn 不存在：${turnId}` });
      return turn;
    },
  );

  app.get(
    '/api/agents/:agentId/turns/:turnId/events',
    { preHandler: auth },
    async (request) => {
      const { agentId, turnId } = request.params as { agentId: string; turnId: string };
      const query = request.query as { afterSeq?: string; beforeSeq?: string; limit?: string };
      const agent = await requireAgent(agentId);
      return agent.turns.events(turnId, {
        afterSeq: parseAfterSeq(query.afterSeq),
        beforeSeq: parseBeforeSeq(query.beforeSeq),
        limit: parseLimitQuery(query.limit),
      });
    },
  );

  app.get('/api/agents/:agentId/events', { preHandler: auth }, async (request) => {
    const { agentId } = request.params as { agentId: string };
    const query = request.query as { afterSeq?: string; beforeSeq?: string; limit?: string };
    const agent = await requireAgent(agentId);
    return agent.events({
      afterSeq: parseAfterSeq(query.afterSeq),
      beforeSeq: parseBeforeSeq(query.beforeSeq),
      limit: parseLimitQuery(query.limit, 200, MAX_AGENT_EVENT_LIMIT),
    });
  });
}
