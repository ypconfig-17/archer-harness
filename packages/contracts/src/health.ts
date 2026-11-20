/**
 * Archer Harness — 服务健康信息
 */

import { z } from 'zod';

/** 启动恢复失败诊断；不推断损坏记录中的会话状态。 */
export const RecoveryFailureSchema = z.object({
  agentId: z.string(),
  reason: z.string(),
});
export type RecoveryFailure = z.infer<typeof RecoveryFailureSchema>;

export const HealthInfoSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  /** 当前推理实现 */
  inference: z.enum(['mock', 'pi']),
  /** 启动时无法从日志恢复的会话数量；未提供表示入口未装配诊断。 */
  recoveryFailures: z.number().int().nonnegative().optional(),
});
export type HealthInfo = z.infer<typeof HealthInfoSchema>;
