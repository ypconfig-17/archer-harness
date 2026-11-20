import type { TaskPlan } from '@archer/contracts';
import { Icon, Plan, Trace } from '@archer/ui';

/** 只转换已提交的计划声明状态；不从步骤完成推断工具验证或整轮成功。 */
export function PlanProgress({ plan }: { plan: TaskPlan }) {
  return (
    <section className="desktop-plan-presentation" aria-label="计划声明进度">
      <Trace density="compact">
        <Plan
          title="计划声明步骤"
          icon={<Icon name="list" size="sm" />}
          defaultOpen
          showProgress={false}
          showStepStatus={false}
          steps={plan.steps.map((step, index) => ({
            id: `${index}`,
            text: step.text,
            status: step.status === 'in_progress' ? 'running' : step.status,
          }))}
        />
      </Trace>
      <small className="execution-muted">模型声明 · 步骤状态不代表外部执行验证</small>
    </section>
  );
}
