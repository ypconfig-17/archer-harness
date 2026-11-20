/**
 * Archer Harness — 可选的管理令牌鉴权
 *
 * HARNESS_TOKEN 为空时关闭鉴权，适合本机开发。
 * HTTP 与 SSE 都通过 Bearer 头鉴权。
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

export type AuthHook = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function createAuthHook(token?: string): AuthHook {
  return async (request, reply) => {
    if (!token) return;

    const authorization = request.headers.authorization;
    if (authorization !== `Bearer ${token}`) {
      await reply.code(401).send({ error: '未授权：管理令牌缺失或不正确' });
    }
  };
}
