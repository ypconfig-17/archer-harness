import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { QueuePanel } from '../../../apps/desktop/renderer/src/ui/workspace/QueuePanel';

const props = {
  paused: true,
  queued: [],
  steering: [],
  disabled: false,
  resumePending: false,
  clearPending: false,
  onResume() {},
  onClear() {},
};

it('停止并清空后不展示空队列或无任务可恢复的按钮', () => {
  expect(renderToStaticMarkup(createElement(QueuePanel, props))).toBe('');
});

it('积压的暂停队列显示内容及恢复入口，操作锁同时禁止恢复和清空', () => {
  const queued = [{ inputId: 'i1', input: '下一任务' }];
  const markup = renderToStaticMarkup(createElement(QueuePanel, { ...props, queued, disabled: true }));
  expect(markup).toContain('下一任务');
  expect(markup).toContain('已暂停');
  expect(markup).toContain('恢复队列');
  expect(markup).toContain('清空队列');
  // 基础按钮同时暴露 disabled 与 data-disabled；只统计原生禁用属性。
  expect(markup.match(/ disabled=""/g)).toHaveLength(2);
});

it('只有待应用引导时保留内容，不展示恢复空队列入口', () => {
  const steering = [{ inputId: 's1', input: '补充要求' }];
  const markup = renderToStaticMarkup(createElement(QueuePanel, { ...props, steering }));
  expect(markup).toContain('补充要求');
  expect(markup).not.toContain('恢复队列');
  expect(markup).not.toContain('队列为空');
});

it('用顺序号呈现任务，总数包含补充输入，不暴露内部请求标识', () => {
  const queued = [{ inputId: 'internal-input-a', input: '下一任务' }];
  const steering = [{ inputId: 'internal-steering-a', input: '补充要求' }];
  const markup = renderToStaticMarkup(createElement(QueuePanel, { ...props, queued, steering }));
  expect(markup).toContain('input-queue-count">2</span>');
  expect(markup).toContain('aria-label="排队任务"');
  expect(markup).toContain('下一任务');
  expect(markup).not.toContain('internal-input-a');
  expect(markup).not.toContain('internal-steering-a');
});
