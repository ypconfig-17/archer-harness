import type { TurnSnapshot, TurnStatus } from '@archer/contracts';

/** 活跃身份优先于异步快照，避免旧任务终态短暂覆盖正在执行的新任务。 */
export function sidebarTurnStatus(
  activeTurnId: string | null,
  active: Pick<TurnSnapshot, 'turnId' | 'status'> | null | undefined,
  latest: Pick<TurnSnapshot, 'status'> | null | undefined,
): TurnStatus | undefined {
  if (activeTurnId) return active?.turnId === activeTurnId ? active.status : 'running';
  // 未读到任务事实时保持未知，不能由空闲推断成功。
  return latest?.status;
}

/** 终态完成与已停止不留提醒点；空闲也不等于完成或未读。 */
export function sidebarStatusLabel(status?: TurnStatus): string | undefined {
  switch (status) {
    case 'running': return '任务进行中';
    case 'waiting': return '等待确认';
    case 'cancelling': return '正在停止';
    case 'failed': return '最近任务失败';
    default: return undefined;
  }
}
