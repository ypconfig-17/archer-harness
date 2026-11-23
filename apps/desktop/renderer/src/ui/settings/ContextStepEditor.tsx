import { REASONING_LEVELS, type ContextCondition, type ContextStep, type ReasoningLevel } from '@archer/contracts';
import { REASONING_LABELS } from '../../lib/model-selection';
import { ContextConditionEditor, ContextNumberField, METRIC_LABELS, OPERATOR_LABELS } from './ContextFields';
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Icon, NativeSelect, Switch } from '@archer/ui';
import { SettingRow } from './SettingsControls';

const STEP_TITLES: Record<ContextStep['kind'], string> = {
  compact: '历史摘要压缩',
  'trim-tool-results': '超窗工具结果节选',
};

function conditionSummary(condition: ContextCondition): string {
  if (condition.kind === 'compare') {
    return `${METRIC_LABELS[condition.metric]} ${OPERATOR_LABELS[condition.op]} ${condition.value}`;
  }
  return `${condition.kind === 'all' ? '全部满足' : '任一满足'}（${condition.conditions.map(conditionSummary).join('；')}）`;
}

function stepSummary(step: ContextStep): string {
  const trigger = step.kind === 'compact' ? '容量线或增长线命中时执行' : '仅在完整输入超过输入额度时执行';
  return step.when ? `${trigger}；条件：${conditionSummary(step.when)}` : trigger;
}

export function newContextStep(kind: ContextStep['kind'], steps: readonly ContextStep[]): ContextStep {
  const ids = new Set(steps.map(step => step.id));
  const base = kind === 'compact' ? 'compact' : 'trim';
  let index = 1;
  while (ids.has(`${base}-${index}`)) index += 1;
  return kind === 'compact'
    ? {
        kind: 'compact',
        id: `${base}-${index}`,
        enabled: true,
        params: { reserveTokens: 16_384, growthTokens: 100_000, keepRecentTokens: 20_000, summaryBudgetTokens: 0 },
      }
    : { kind: 'trim-tool-results', id: `${base}-${index}`, enabled: true, params: { minSavingsRatio: 0.25 } };
}

/** 步骤列表按顺序执行；重排只改变优先级，不复制参数。 */
export function ContextStepEditor({ steps, onSteps }: {
  steps: readonly ContextStep[];
  onSteps(steps: ContextStep[]): void;
}) {
  function update(index: number, next: ContextStep) {
    onSteps(steps.map((step, position) => position === index ? next : step));
  }

  function move(index: number, offset: number) {
    const target = index + offset;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onSteps(next);
  }

  return <div className="context-steps">
    {steps.map((step, index) => <Collapsible className="context-step" key={step.id}>
      <div className="context-step-heading">
        <CollapsibleTrigger render={<Button variant="ghost" className="context-step-toggle" />}>
          <span className="context-step-number">{index + 1}</span>
          <span className="context-step-copy">
            <strong>{STEP_TITLES[step.kind]}</strong>
            <small>{stepSummary(step)}</small>
          </span>
          <Icon name="chevron-down" size="xs" className="context-step-chevron" />
        </CollapsibleTrigger>
        <span className="context-step-actions">
          <Switch label={`启用${STEP_TITLES[step.kind]}`} checked={step.enabled} onCheckedChange={enabled => update(index, { ...step, enabled })} />
          <Button variant="ghost" size="icon-xs" aria-label="上移步骤" disabled={index === 0} onClick={() => move(index, -1)}><Icon name="arrow-up" size="sm" /></Button>
          <Button variant="ghost" size="icon-xs" aria-label="下移步骤" disabled={index === steps.length - 1} onClick={() => move(index, 1)}><Icon name="arrow-down" size="sm" /></Button>
          <Button variant="ghost" size="icon-xs" aria-label="删除步骤" disabled={steps.length === 1} onClick={() => onSteps(steps.filter((_, position) => position !== index))}><Icon name="trash" size="sm" /></Button>
        </span>
      </div>
      <CollapsibleContent className="context-step-body">
        {step.kind === 'compact' ? <>
          <ContextNumberField
            fieldKey={`${step.id}.reserveTokens`}
            label="Token 触发预留"
            hint="完整输入超过输入额度减去该预留时整理；实际预留不超过额度的 15%，0 表示只在超过额度时由容量线触发。"
            value={step.params.reserveTokens}
            min={0}
            max={1_000_000}
            onChange={reserveTokens => update(index, { ...step, params: { ...step.params, reserveTokens } })}
          />
          <ContextNumberField
            fieldKey={`${step.id}.growthTokens`}
            label="历史增长阈值"
            hint="尚未被摘要覆盖的原始历史超过该值时提前整理；与窗口大小无关。"
            value={step.params.growthTokens}
            min={1}
            max={1_000_000}
            onChange={growthTokens => update(index, { ...step, params: { ...step.params, growthTokens } })}
          />
          <ContextNumberField
            fieldKey={`${step.id}.keepRecentTokens`}
            label="近期消息保护量"
            hint="摘要后保留的近期原文目标；按完整调用批次保留，实际不超过输入额度的 25%。"
            value={step.params.keepRecentTokens}
            min={1}
            max={1_000_000}
            onChange={keepRecentTokens => update(index, { ...step, params: { ...step.params, keepRecentTokens } })}
          />
          <SettingRow label="摘要输出预算" hint="自动按模型窗口取值（最多 16,384）；关闭后可固定预算，思考与正文共享该额度。">
            <div className="context-budget-field">
              <span>{step.params.summaryBudgetTokens === 0 ? '自动' : '固定'}</span>
              <Switch
                label="自动摘要预算"
                checked={step.params.summaryBudgetTokens === 0}
                onCheckedChange={automatic => update(index, { ...step, params: { ...step.params, summaryBudgetTokens: automatic ? 0 : 8_192 } })}
              />
            </div>
          </SettingRow>
          {step.params.summaryBudgetTokens > 0 && <ContextNumberField
            fieldKey={`${step.id}.summaryBudgetTokens`}
            label="固定摘要预算"
            value={step.params.summaryBudgetTokens}
            min={1_024}
            max={65_536}
            step={1_024}
            onChange={summaryBudgetTokens => update(index, { ...step, params: { ...step.params, summaryBudgetTokens } })}
          />}
          <label className="context-reasoning-field">
            <span>Compaction 推理等级</span>
            <NativeSelect
              aria-label="Compaction 推理等级"
              value={step.params.reasoning ?? ''}
              onChange={event => update(index, {
                ...step,
                params: { ...step.params, reasoning: event.target.value ? event.target.value as ReasoningLevel : undefined },
              })}
            >
              <option value="">跟随任务</option>
              {REASONING_LEVELS.map(level => <option key={level} value={level}>{REASONING_LABELS[level]}</option>)}
            </NativeSelect>
            <small>只影响摘要请求；容量线和窗口准入不受影响。</small>
          </label>
        </> : <ContextNumberField
          fieldKey={`${step.id}.minSavingsRatio`}
          label="节选收益下限"
          hint="以节选前完整输入为分母计算节省比例；低于该值保持原文。单条工具正文最多保留输入额度的 25%。"
          value={step.params.minSavingsRatio}
          min={0.05}
          max={0.75}
          step={0.05}
          integer={false}
          unit="比例"
          onChange={minSavingsRatio => update(index, { ...step, params: { ...step.params, minSavingsRatio } })}
        />}
        <div className="context-step-conditions">
          <div className="context-step-conditions-heading">
            <strong>执行条件（可选）</strong>
            {step.when && <Button variant="link" size="xs" onClick={() => update(index, { ...step, when: undefined })}>清除条件</Button>}
          </div>
          {step.when
            ? <ContextConditionEditor
                condition={step.when}
                path={`${step.id}.when`}
                depth={1}
                onChange={when => update(index, { ...step, when })}
              />
            : <div className="context-condition-empty">
                <p>未设置附加条件：步骤只按上方触发线执行。</p>
                <Button variant="link" size="xs" onClick={() => update(index, { ...step, when: { kind: 'compare', metric: 'historyMessages', op: 'gte', value: 1 } })}>
                  <Icon name="plus" size="xs" />条件
                </Button>
                <Button variant="link" size="xs" onClick={() => update(index, { ...step, when: { kind: 'all', conditions: [{ kind: 'compare', metric: 'historyMessages', op: 'gte', value: 1 }] } })}>
                  <Icon name="plus" size="xs" />条件组
                </Button>
              </div>}
        </div>
      </CollapsibleContent>
    </Collapsible>)}
    <div className="context-step-add">
      <Button variant="secondary" disabled={steps.length >= 8} onClick={() => onSteps([...steps, newContextStep('compact', steps)])}><Icon name="plus" size="sm" />摘要步骤</Button>
      <Button variant="secondary" disabled={steps.length >= 8} onClick={() => onSteps([...steps, newContextStep('trim-tool-results', steps)])}><Icon name="plus" size="sm" />工具结果节选</Button>
    </div>
  </div>;
}
