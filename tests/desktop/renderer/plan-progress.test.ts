/** 计划视觉状态只来自声明，不能伪造步骤耗时。 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PlanProgress } from '../../../apps/desktop/renderer/src/ui/workspace/PlanProgress';

it('区分部分完成和声明完成，保留相同结构及来源说明', () => {
  const plan = { planId: 'p', revision: 1, title: '核对事件', steps: [
    { text: '读取事件', status: 'completed' as const },
    { text: '核对规则', status: 'in_progress' as const },
  ] };
  const running = renderToStaticMarkup(createElement(PlanProgress, { plan }));
  expect(running).toContain('1/2 · 模型声明');
  expect(running).toContain('data-status="running"');
  expect(running).toContain('模型声明');
  expect(running).not.toContain('is-completed" aria-label="计划声明进度"');
  const done = renderToStaticMarkup(createElement(PlanProgress, { plan: {
    ...plan, steps: plan.steps.map(step => ({ ...step, status: 'completed' as const })),
  } }));
  expect(done).toContain('2/2 · 模型声明');
  expect(done).toContain('archer-plan is-completed');
  expect(done).not.toContain('data-status="running"');
  expect(done).not.toContain('秒');
});
