/** 领域状态的中文文案；会话头部、任务导航与检查面板共用。 */
import type { AgentExecution, CommandMode, EffectType, MessageRole, TurnStatus } from '@archer/contracts';

export const TURN_STATUS_LABELS = {
  running: '进行中',
  waiting: '等待处理',
  cancelling: '等待取消确认',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
} as const satisfies Record<TurnStatus, string>;

export const EXECUTION_LABELS = {
  ready: '就绪',
  blocked: '等待接入',
  isolated: '已隔离'
} as const satisfies Record<AgentExecution, string>;

export const COMMAND_MODE_LABELS = {
  ask: '每次询问',
  auto: '自动审批',
  full: '完全访问'
} as const satisfies Record<CommandMode, string>;

export const WORKSPACE_ACCESS_LABELS = {
  read: '只读',
  edit: '可编辑'
} as const;

export const MESSAGE_ROLE_LABELS = {
  system: '系统',
  user: '用户',
  assistant: '助手',
  tool: '工具'
} as const satisfies Record<MessageRole, string>;

export const EFFECT_TYPE_LABELS = {
  INFER: '模型推理',
  CALL: '能力调用',
} as const satisfies Record<EffectType, string>;

/** 命令授权同时包含开关与审批模式，界面只展示一个结论。 */
export function commandAuthorizationLabel(allowShell: boolean, mode: CommandMode): string {
  return allowShell ? COMMAND_MODE_LABELS[mode] : '关闭';
}

/** Turn id 前缀是 Agent id；界面只展示任务序号。 */
export function turnNumber(turnId: string): string {
  return turnId.split(':t').at(-1) ?? turnId;
}
