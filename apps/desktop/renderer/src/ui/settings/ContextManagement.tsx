import { Input } from '@archer/ui';
import {
  DEFAULT_CONTEXT_PROFILE_ID,
  REASONING_LEVELS,
  builtinContextProfile,
  builtinContextProfiles,
  cloneContextProfile,
  defaultContextProfile,
  isBuiltinContextProfile,
  resolveContextProfile,
  validateContextProfile,
  type AgentEvent,
  type ContextProfile,
  type ContextStep,
  type ReasoningLevel,
  type Snapshot,
} from '@archer/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildItems } from '../../lib/conversation';
import { REASONING_LABELS } from '../../lib/model-selection';
import { inferenceContext } from '../../lib/task-insights';
import { useAgentStreamStore } from '../../store/agent-stream';
import { copyContextProfile, usePreferences } from '../../store/preferences';
import { ContextFieldErrors, ContextNumberField } from './ContextFields';
import { ContextStepEditor, newContextStep } from './ContextStepEditor';
import { Button, ConfirmDialog, Icon, NativeSelect, Switch } from '@archer/ui';
import { SettingRow, SettingsSaveBar, type SettingsEditorState } from './SettingsControls';

const REASON_LABELS = { capacity: '容量线', growth: '增长线', overflow: '超窗' } as const;
const KIND_LABELS = { compact: '历史摘要', 'trim-tool-results': '工具结果节选' } as const;
const EMPTY_EVENTS: readonly Snapshot<AgentEvent>[] = [];

/** revision 由 store 在保存时递增，比较配置时忽略它，避免刚保存就再次显示未保存。 */
function sameConfig(left: ContextProfile, right: ContextProfile): boolean {
  return JSON.stringify({ ...left, revision: 0 }) === JSON.stringify({ ...right, revision: 0 });
}

type CompactStep = Extract<ContextStep, { kind: 'compact' }>;

/**
 * 上下文管理设置页：编辑声明式 Profile 并展示最近一次已提交的整理记录。
 * 页面不执行策略，也不决定安全边界；保存只写入本机新任务默认值。
 */
export function ContextManagement({ agentId, onStateChange }: {
  agentId: string | null;
  onStateChange(state: SettingsEditorState): void;
}) {
  const prefs = usePreferences();
  const [builtins] = useState(builtinContextProfiles);
  const [draft, setDraft] = useState<ContextProfile>(() => resolveContextProfile(prefs.activeContextProfileId, prefs.customContextProfiles));
  const [budget, setBudget] = useState(prefs.tokenBudget === null ? '' : String(prefs.tokenBudget));
  const [pendingSelect, setPendingSelect] = useState<string | null>(null);
  const [profileRemoval, setProfileRemoval] = useState<ContextProfile | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState(false);
  const [saved, setSaved] = useState('');
  const [saveError, setSaveError] = useState('');

  const persisted = prefs.customContextProfiles.find(profile => profile.id === draft.id);
  // 自动复制的副本尚未保存也要出现在模板列表中，避免编辑时看不出当前草稿归属。
  const profiles = useMemo(() => {
    const known = [...builtins, ...prefs.customContextProfiles];
    return known.some(profile => profile.id === draft.id) ? known : [...known, draft];
  }, [builtins, draft, prefs.customContextProfiles]);
  const savedProfile = persisted ?? builtinContextProfile(draft.id);
  const configDirty = !savedProfile || !sameConfig(draft, savedProfile);
  const budgetDirty = budget.trim() !== (prefs.tokenBudget === null ? '' : String(prefs.tokenBudget));
  // 仅切换模板也会让页面等待保存，但没有可丢失的编辑；切换确认只看真正的配置改动。
  const edited = configDirty || budgetDirty;
  const dirty = edited || draft.id !== prefs.activeContextProfileId;
  const issues = validateContextProfile(draft);
  const budgetValid = budget.trim() === '' || (Number.isSafeInteger(Number(budget)) && Number(budget) > 0);
  const budgetError = budgetValid ? '' : '请输入正整数，或留空表示不限制。';
  const blocked = issues.length > 0 || !budgetValid || Object.keys(fieldErrors).length > 0;
  const compactSteps = draft.steps.filter((step): step is CompactStep => step.kind === 'compact');
  const compact = compactSteps[0];
  const trim = draft.steps.find(step => step.kind === 'trim-tool-results');
  const builtin = isBuiltinContextProfile(draft.id);
  const activeProfile = resolveContextProfile(prefs.activeContextProfileId, prefs.customContextProfiles);
  const pending = pendingSelect ? profiles.find(profile => profile.id === pendingSelect) : undefined;

  useEffect(() => onStateChange({ dirty, busy: false }), [dirty, onStateChange]);
  const reportField = useCallback((key: string, message: string) => {
    setFieldErrors(current => {
      if (message) return current[key] === message ? current : { ...current, [key]: message };
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);
  useEffect(() => reportField('token-budget', budgetError), [budgetError, reportField]);

  function updateDraft(recipe: (profile: ContextProfile) => void) {
    setDraft(current => {
      let next = cloneContextProfile(current);
      // 内置模板只读；首次修改自动生成自定义副本，后续编辑保持同一个副本。
      if (isBuiltinContextProfile(next.id)) next = copyContextProfile(next);
      recipe(next);
      return next;
    });
    setPendingSelect(null);
    setAttempted(false);
    setSaved('');
    setSaveError('');
  }

  function updateCompact(recipe: (step: CompactStep) => void) {
    updateDraft(profile => {
      const step = profile.steps.find(item => item.kind === 'compact');
      if (!step || step.kind !== 'compact') return;
      recipe(step);
    });
  }

  function applyProfile(id: string) {
    setDraft(resolveContextProfile(id, prefs.customContextProfiles));
    setPendingSelect(null);
    setFieldErrors({});
    setAttempted(false);
    setSaved('');
    setSaveError('');
  }

  function requestProfile(id: string) {
    if (id === draft.id) return;
    if (edited) {
      setPendingSelect(id);
      return;
    }
    applyProfile(id);
  }

  function save() {
    setAttempted(true);
    if (blocked) return;
    try {
      // 未修改的内置模板只是选择，不创建副本；只有自定义草稿才写入并递增修订号。
      const stored = prefs.customContextProfiles.find(profile => profile.id === draft.id);
      if (isBuiltinContextProfile(draft.id) || (stored && sameConfig(draft, stored))) prefs.selectContextProfile(draft.id);
      else prefs.saveContextProfile(draft);
      prefs.setTokenBudget(budget.trim() ? Number(budget) : null);
      setAttempted(false);
      setSaveError('');
      setSaved('已保存。之后发送或排队的新任务使用该配置快照。');
    } catch (cause) {
      setSaved('');
      setSaveError((cause as Error).message);
    }
  }

  function discard() {
    setDraft(resolveContextProfile(prefs.activeContextProfileId, prefs.customContextProfiles));
    setBudget(prefs.tokenBudget === null ? '' : String(prefs.tokenBudget));
    setFieldErrors({});
    setPendingSelect(null);
    setAttempted(false);
    setSaved('');
    setSaveError('');
  }

  function resetDefaults() {
    setDraft(defaultContextProfile());
    setBudget('');
    setFieldErrors({});
    setPendingSelect(null);
    setAttempted(false);
    setSaved('');
    setSaveError('');
  }

  function removeProfile() {
    const target = prefs.customContextProfiles.find(profile => profile.id === draft.id);
    if (target) setProfileRemoval(target);
  }

  return <>
    {profileRemoval && <ConfirmDialog
      title={`删除「${profileRemoval.name}」？`}
      description="这会删除本机的自定义策略配置。已提交的会话记录不受影响。"
      confirmLabel="删除配置"
      onClose={() => setProfileRemoval(null)}
      onConfirm={() => {
        // 删除仍然只写本机偏好；关闭或取消确认不会改动草稿与当前生效配置。
        prefs.deleteContextProfile(profileRemoval.id);
        setProfileRemoval(null);
        applyProfile(DEFAULT_CONTEXT_PROFILE_ID);
      }}
    />}
    <ContextFieldErrors.Provider value={reportField}>
      <div className="settings-scroll">
        <section className="settings-group">
          <h4>策略模板</h4>
          <p className="settings-note">当前生效：<strong>{activeProfile.name}</strong>{isBuiltinContextProfile(activeProfile.id) ? '（内置模板）' : `（自定义 · 修订 ${activeProfile.revision}）`}。选择或修改后保存，用于之后发送或排队的新任务；正在执行的任务继续使用开始时的快照。</p>
          <SettingRow label="策略模板" hint={draft.description || '未填写说明。'}>
            <NativeSelect aria-label="上下文策略模板" value={draft.id}
              onChange={event => requestProfile(event.target.value)}>
              {profiles.map(profile => <option key={profile.id} value={profile.id}>
                {profile.name}{isBuiltinContextProfile(profile.id) ? ' · 内置' : ` · r${profile.revision}`}
                {profile.id === prefs.activeContextProfileId ? ' · 当前生效' : ''}
              </option>)}
            </NativeSelect>
          </SettingRow>
          <p className="settings-note">
            {draft.steps.filter(step => step.enabled).length} / {draft.steps.length} 个步骤启用
            {!builtin && !prefs.customContextProfiles.some(saved => saved.id === draft.id) ? ' · 自定义副本尚未保存' : ''}
          </p>
          {pending && <div className="context-pending" role="alert">
            <span>切换到「{pending.name}」会放弃当前未保存的修改。</span>
            <div>
              <Button variant="secondary" onClick={() => setPendingSelect(null)}>继续编辑</Button>
              <Button variant="default" onClick={() => applyProfile(pending.id)}>放弃修改并切换</Button>
            </div>
          </div>}
          <div className="context-profile-actions">
            <Button variant="secondary" onClick={() => { setDraft(copyContextProfile(draft)); setSaved(''); setSaveError(''); setAttempted(false); }}>
              <Icon name="copy" size="sm" />复制为自定义
            </Button>
            {persisted && <Button variant="secondary" onClick={removeProfile}><Icon name="trash" size="sm" />删除自定义 Profile</Button>}
            <Button variant="secondary" onClick={resetDefaults}><Icon name="refresh" size="sm" />恢复默认</Button>
          </div>
          <SettingRow label="Profile 名称" hint={builtin ? '内置模板不可直接修改；输入名称或调整任意参数会创建自定义副本。' : '用于设置页和执行记录识别这个配置。'}>
            <Input aria-label="Profile 名称" maxLength={80} value={draft.name} onChange={event => {
              const name = event.target.value;
              updateDraft(profile => { profile.name = name; });
            }} />
          </SettingRow>
          <SettingRow label="说明" hint="最多 240 个字符，仅用于本机识别。">
            <Input aria-label="Profile 说明" maxLength={240} value={draft.description} onChange={event => {
              const description = event.target.value;
              updateDraft(profile => { profile.description = description; });
            }} />
          </SettingRow>
        </section>

        <section className="settings-group">
          <h4>基础参数</h4>
          {compact ? <>
            <p className="settings-note">以下参数编辑链中第一个摘要步骤{compactSteps.length > 1 ? `（共 ${compactSteps.length} 个摘要步骤，其余在高级策略链中配置）` : ''}。</p>
            <SettingRow label="自动摘要" hint="关闭后不再调用模型生成摘要；超窗时仍由工具结果节选和窗口准入处理。">
              <Switch label="自动摘要" checked={compact.enabled} onCheckedChange={enabled => updateCompact(step => { step.enabled = enabled; })} />
            </SettingRow>
            <ContextNumberField
              fieldKey={`${draft.id}.base.reserveTokens`}
              label="Token 触发阈值"
              hint="完整输入超过输入额度减去该预留时整理；实际预留不超过输入额度的 15%，0 表示只在容量线兜底时触发。"
              value={compact.params.reserveTokens}
              min={0}
              max={1_000_000}
              onChange={reserveTokens => updateCompact(step => { step.params.reserveTokens = reserveTokens; })}
            />
            <ContextNumberField
              fieldKey={`${draft.id}.base.growthTokens`}
              label="历史增长阈值"
              hint="尚未被摘要覆盖的原始历史超过该值时提前整理；与窗口大小无关。"
              value={compact.params.growthTokens}
              min={1}
              max={1_000_000}
              onChange={growthTokens => updateCompact(step => { step.params.growthTokens = growthTokens; })}
            />
            <ContextNumberField
              fieldKey={`${draft.id}.base.keepRecentTokens`}
              label="近期消息保护量"
              hint="摘要后保留的近期原文目标；按完整调用批次保留，实际不超过输入额度的 25%。"
              value={compact.params.keepRecentTokens}
              min={1}
              max={1_000_000}
              onChange={keepRecentTokens => updateCompact(step => { step.params.keepRecentTokens = keepRecentTokens; })}
            />
            <SettingRow label="摘要输出预算" hint="自动按模型窗口取值（最多 16,384）；关闭后可固定预算，思考与正文共享该额度。">
              <div className="context-budget-field">
                <span>{compact.params.summaryBudgetTokens === 0 ? '自动' : '固定'}</span>
                <Switch label="自动摘要预算" checked={compact.params.summaryBudgetTokens === 0} onCheckedChange={automatic => updateCompact(step => { step.params.summaryBudgetTokens = automatic ? 0 : 8_192; })} />
              </div>
            </SettingRow>
            {compact.params.summaryBudgetTokens > 0 && <ContextNumberField
              fieldKey={`${draft.id}.base.summaryBudgetTokens`}
              label="固定摘要预算"
              value={compact.params.summaryBudgetTokens}
              min={1_024}
              max={65_536}
              step={1_024}
              onChange={summaryBudgetTokens => updateCompact(step => { step.params.summaryBudgetTokens = summaryBudgetTokens; })}
            />}
            <SettingRow label="Compaction 推理等级" hint="只影响摘要请求；缺省沿用任务的推理等级。">
              <NativeSelect aria-label="Compaction 推理等级" value={compact.params.reasoning ?? ''} onChange={event => updateCompact(step => {
                step.params.reasoning = event.target.value ? event.target.value as ReasoningLevel : undefined;
              })}>
                <option value="">跟随任务</option>
                {REASONING_LEVELS.map(level => <option key={level} value={level}>{REASONING_LABELS[level]}</option>)}
              </NativeSelect>
            </SettingRow>
          </> : <p className="settings-note">当前 Profile 没有摘要步骤。添加后即可在这里配置触发阈值与摘要预算。</p>}
          <SettingRow label="工具结果裁剪" hint="仅在完整输入超过输入额度时，将较早的工具正文替换为可读回的节选；不会代替窗口准入。">
            {trim
              ? <Switch label="超窗时裁剪工具结果" checked={trim.enabled} onCheckedChange={enabled => updateDraft(profile => {
                  const step = profile.steps.find(item => item.kind === 'trim-tool-results');
                  if (step) step.enabled = enabled;
                })} />
              : <Button variant="secondary" onClick={() => updateDraft(profile => { profile.steps.push(newContextStep('trim-tool-results', profile.steps)); })}><Icon name="plus" size="sm" />添加节选步骤</Button>}
          </SettingRow>
          {!compact && <div className="settings-inline-actions">
            <Button variant="secondary" onClick={() => updateDraft(profile => { profile.steps.push(newContextStep('compact', profile.steps)); })}><Icon name="plus" size="sm" />添加摘要步骤</Button>
          </div>}
        </section>

        <section className="settings-group">
          <h4>高级策略链</h4>
          <p className="settings-note">按顺序执行第一个满足条件的步骤；整理后重新评估，单次推理最多执行 4 次摘要。触发条件支持 ANY / ALL 嵌套，步骤可启停和排序。</p>
          <ContextStepEditor steps={draft.steps} onSteps={steps => updateDraft(profile => { profile.steps = steps; })} />
        </section>

        <section className="settings-group">
          <h4>固定安全 Guard</h4>
          <p className="settings-note">以下约束由后端执行，页面只读展示，任何 Profile 都不能关闭。</p>
          <ul className="context-guard">
            <li><Icon name="shield" size="sm" /><span><strong>窗口准入</strong>最终请求超过输入额度时拒绝执行；用户消息、固定规则和必要协议开销不能被悄悄缩减。</span></li>
            <li><Icon name="shield" size="sm" /><span><strong>摘要校验</strong>空摘要、被截断、包含工具计划、交接证据无效或没有减少完整输入的摘要不会被采用。</span></li>
            <li><Icon name="shield" size="sm" /><span><strong>完整批次</strong>摘要只替换完整的旧助手与工具交互；用户原文和最近受保护的原文保留，原始历史仍留在执行记录中。</span></li>
            <li><Icon name="shield" size="sm" /><span><strong>可追溯性</strong>实际采用的 Profile 版本、执行步骤和优化前后估算随推理结果一起提交，不根据页面当前配置推测。</span></li>
          </ul>
        </section>

        <section className="settings-group">
          <h4>任务用量</h4>
          <SettingRow label="每任务累计预算" hint="普通推理与摘要共用预算。留空表示不设置累计上限；估算不等于精确计费。">
            <div className="settings-number-field">
              <div>
                <Input aria-label="每任务累计 token 预算" aria-invalid={Boolean(budgetError)} aria-describedby={budgetError ? 'context-budget-error' : undefined} type="number" min="1" step="1" value={budget} placeholder="不限制" onChange={event => setBudget(event.target.value)} />
                <span>token</span>
              </div>
              {budgetError && <small id="context-budget-error">{budgetError}</small>}
            </div>
          </SettingRow>
        </section>

        <section className="settings-group">
          <h4>最近一次策略命中</h4>
          <LatestContextPlan agentId={agentId} active={activeProfile} />
        </section>

        {issues.length > 0 && <section className="settings-group">
          <h4>配置检查</h4>
          <ul className="context-issues">
            {issues.map(issue => <li key={`${issue.path}:${issue.message}`}><Icon name="alert" size="sm" /><span>{issue.message}{issue.path ? `（${issue.path}）` : ''}</span></li>)}
          </ul>
        </section>}

        <section className="settings-group settings-context-scope">
          <div>
            <h4>生效范围</h4>
            <p className="settings-note">配置保存在当前设备，发送或排队时写入任务快照。修改页面不会影响已经接受、执行或等待重试的任务。</p>
          </div>
        </section>
      </div>
    </ContextFieldErrors.Provider>
    <SettingsSaveBar
      dirty={dirty}
      saved={saved}
      error={saveError
        || (Object.keys(fieldErrors).length > 0 ? '请先修正标出的输入问题；无效输入不会保存。' : '')
        || (attempted && blocked ? '请先修正标出的输入与配置检查中的问题。' : '')}
      onReset={discard}
      onSave={save}
    />
  </>;
}

/** 最近一次已提交的整理记录；没有记录时不推测当前会话使用了哪个 Profile。 */
function LatestContextPlan({ agentId, active }: { agentId: string | null; active: ContextProfile }) {
  const events = useAgentStreamStore(state => agentId ? state.eventsByAgent[agentId] ?? EMPTY_EVENTS : EMPTY_EVENTS);
  const plan = useMemo(() => {
    const entries = buildItems(events).flatMap(item => item.kind === 'effect' ? [item.entry] : []);
    return inferenceContext(entries)?.contextPlan;
  }, [events]);
  if (!agentId) return <p className="settings-note">打开一个会话后，这里显示它最近一次推理的整理记录。</p>;
  if (!plan) return <p className="settings-note">该会话尚无已提交的整理记录。</p>;
  const stale = plan.profileId !== active.id || plan.profileRevision !== active.revision;
  return <>
    <div className="context-plan-metrics">
      <div><strong>{plan.beforeTokens.toLocaleString()}</strong><span>整理前估算</span></div>
      <div><strong>{plan.afterTokens.toLocaleString()}</strong><span>实际输入估算</span></div>
      <div><strong>{plan.inputLimit.toLocaleString()}</strong><span>输入额度</span></div>
    </div>
    <p className="settings-note">由「{plan.profileName}」第 {plan.profileRevision} 版处理，命中 {plan.steps.length} 个步骤。{stale ? '该记录来自另一个配置快照；页面修改只影响之后的新任务。' : ''}</p>
    {plan.steps.length > 0 && <ol className="context-plan-steps">
      {plan.steps.map((step, index) => <li key={`${step.stepId}-${index}`}>
        <span className="context-step-number">{index + 1}</span>
        <strong>{KIND_LABELS[step.kind]}</strong>
        <code>{step.stepId}</code>
        <span className="context-badge">{REASON_LABELS[step.reason]}</span>
        <span>{step.beforeTokens.toLocaleString()} → {step.afterTokens.toLocaleString()} tokens</span>
      </li>)}
    </ol>}
  </>;
}
