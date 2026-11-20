/**
 * Archer Harness — 健康检查
 */

import type { FastifyInstance } from 'fastify';
import type { HealthInfo } from '@archer/contracts';
import { VERSION } from '../version.js';

export interface HealthRouteOptions {
  inference: HealthInfo['inference'] | (() => HealthInfo['inference']);
  recoveryFailures?: () => number;
}

export function registerHealthRoute(
  app: FastifyInstance,
  options: HealthRouteOptions,
): void {
  app.get('/api/health', async (): Promise<HealthInfo> => ({
    ok: true,
    ...(options.recoveryFailures ? { recoveryFailures: options.recoveryFailures() } : {}),
    version: VERSION,
    inference: typeof options.inference === 'function' ? options.inference() : options.inference,
  }));
}
