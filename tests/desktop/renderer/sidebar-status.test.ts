import { expect, it } from 'vitest';
import { sidebarTurnStatus, sidebarStatusLabel } from '../../../apps/desktop/renderer/src/lib/sidebar-status';

it('新任务不被异步读取的旧终态覆盖，等待与停止保持事实状态', () => {
  expect(sidebarTurnStatus('new', { turnId: 'old', status: 'completed' }, { status: 'completed' })).toBe('running');
  for (const status of ['waiting', 'cancelling', 'running'] as const) {
    expect(sidebarTurnStatus('new', { turnId: 'new', status }, undefined)).toBe(status);
  }
});

it('空闲保留最近任务终态，没有事实时不推断完成', () => {
  for (const status of ['completed', 'failed', 'cancelled'] as const) {
    expect(sidebarTurnStatus(null, null, { status })).toBe(status);
  }
  expect(sidebarTurnStatus(null, null, undefined)).toBeUndefined();
});

it('行尾只提示进行中、等待、停止确认与失败，完成和已停止清空提示', () => {
  expect(sidebarStatusLabel('running')).toBe('任务进行中');
  expect(sidebarStatusLabel('waiting')).toBe('等待确认');
  expect(sidebarStatusLabel('cancelling')).toBe('正在停止');
  expect(sidebarStatusLabel('failed')).toBe('最近任务失败');
  for (const status of ['completed', 'cancelled', undefined] as const) {
    expect(sidebarStatusLabel(status)).toBeUndefined();
  }
});
