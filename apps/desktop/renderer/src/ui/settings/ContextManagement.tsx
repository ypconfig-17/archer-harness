import {
  DEFAULT_CONTEXT_PROFILE_ID,
  builtinContextProfiles,
  cloneContextProfile,
  isBuiltinContextProfile,
  resolveContextProfile,
  validateContextProfile,
  type AgentEvent,
  type ContextProfile,
  type ContextStep,
  type Snapshot,
} from '@archer/contracts';
import { Button, Icon, Input, NativeSelect, SegmentedControl, Switch } from '@archer/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildItems } from '../../lib/conversation';
import {
  CONTEXT_WINDOW_PRESETS,
  simulateContextProfile,
  type ContextWindowPreset,
} from '../../lib/context-simulation';
import { inferenceContext } from '../../lib/task-insights';
import { useAgentStreamStore } from '../../store/agent-stream';
import { copyContextProfile, usePreferences } from '../../store/preferences';
import { SettingRow, type SettingsEditorState } from './SettingsControls';

const REASON_LABELS = { capacity: '容量线', growth: '增长线', overflow: '超窗' } as const;
const KIND_LABELS = { compact: '历史摘要', 'trim-tool-results': '工具结果节选' } as const;
const EMPTY_EVENTS: readonly Snapshot<AgentEvent>[] = [];
const WORKSPACE_CEILING_OPTIONS = [
  { value: '100000', label: '100K' },
  { value: '160000', label: '160K（推荐）' },
  { value: '200000', label: '200K' },
  { value: '0', label: '不封顶' },
] as const;

type CompactStep = Extract<ContextStep, { kind: 'compact' }>;

/**
 * 上下文设置页（即时保存）：
 * 切换模式、拨动开关或松开滑块后直接写入本机偏好，用于后续新任务；
 * 正在执行的任务继续沿用开始时的配置快照。
 */
export function ContextManagement({
  agentId,
  onStateChange,
}: {
  agentId: string | null;
  onStateChange(state: SettingsEditorState): void;
}) {
  const prefs = usePreferences();
  const [builtins] = useState(builtinContextProfiles);
  const activeProfile = useMemo(
    () => resolveContextProfile(prefs.activeContextProfileId, prefs.customContextProfiles),
    [prefs.activeContextProfileId, prefs.customContextProfiles],
  );
  // 滑块拖动期间使用本地预览草稿，松手后再一次性提交到偏好存储，避免连续递增 revision。
  const [previewDraft, setPreviewDraft] = useState<ContextProfile | null>(null);
  const draft = previewDraft ?? activeProfile;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const [budgetInput, setBudgetInput] = useState(() =>
    prefs.tokenBudget === null ? '' : String(prefs.tokenBudget),
  );
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    setBudgetInput(prefs.tokenBudget === null ? '' : String(prefs.tokenBudget));
  }, [prefs.tokenBudget]);

  useEffect(() => {
    onStateChange({ dirty: false, busy: false });
  }, [onStateChange]);

  const profiles = useMemo(() => {
    const known = [...builtins, ...prefs.customContextProfiles];
    return known.some((profile) => profile.id === draft.id) ? known : [...known, draft];
  }, [builtins, draft, prefs.customContextProfiles]);

  const trimmedBudget = budgetInput.trim();
  const budgetValid = trimmedBudget === '' || (Number.isSafeInteger(Number(trimmedBudget)) && Number(trimmedBudget) > 0);
  const budgetError = budgetValid ? '' : '请输入正整数，或留空表示不限制。';

  const compact = draft.steps.find((step): step is CompactStep => step.kind === 'compact');
  const trim = draft.steps.find((step) => step.kind === 'trim-tool-results');
  const isDefaultState = activeProfile.id === DEFAULT_CONTEXT_PROFILE_ID && prefs.tokenBudget === null && !previewDraft;

  function buildNextProfile(base: ContextProfile, recipe: (profile: ContextProfile) => void): ContextProfile {
    let next = cloneContextProfile(base);
    if (isBuiltinContextProfile(next.id)) next = copyContextProfile(next);
    recipe(next);
    return next;
  }

  function persistProfile(next: ContextProfile) {
    const issues = validateContextProfile(next);
    if (issues.length > 0) {
      setSaveError(issues[0]!.message);
      return;
    }
    try {
      prefs.saveContextProfile(next);
      setPreviewDraft(null);
      setSaveError('');
    } catch (cause) {
      setSaveError((cause as Error).message);
    }
  }

  function commitCompactImmediate(recipe: (step: CompactStep) => void) {
    const next = buildNextProfile(draftRef.current, (profile) => {
      const step = profile.steps.find((item) => item.kind === 'compact');
      if (step && step.kind === 'compact') recipe(step);
    });
    persistProfile(next);
  }

  function previewCompactSlider(recipe: (step: CompactStep) => void) {
    const next = buildNextProfile(draftRef.current, (profile) => {
      const step = profile.steps.find((item) => item.kind === 'compact');
      if (step && step.kind === 'compact') recipe(step);
    });
    draftRef.current = next;
    setPreviewDraft(next);
    setSaveError('');
  }

  function flushSliderPreview() {
    if (!previewDraft) return;
    persistProfile(draftRef.current);
  }

  function selectProfile(id: string) {
    setPreviewDraft(null);
    setSaveError('');
    prefs.selectContextProfile(id);
  }

  function resetDefaults() {
    setPreviewDraft(null);
    setSaveError('');
    prefs.selectContextProfile(DEFAULT_CONTEXT_PROFILE_ID);
    prefs.setTokenBudget(null);
    setBudgetInput('');
  }

  function handleBudgetChange(value: string) {
    setBudgetInput(value);
    const trimmed = value.trim();
    if (trimmed === '') {
      if (prefs.tokenBudget !== null) prefs.setTokenBudget(null);
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      if (prefs.tokenBudget !== parsed) prefs.setTokenBudget(parsed);
    }
  }

  return (
    <div className="settings-scroll">
      <section className="settings-group">
        <SettingRow
          label="整理模式"
          hint={draft.description || '选择预设模式，或通过下方滑块微调触发水位。'}
        >
          <div className="context-template-controls">
            <NativeSelect
              aria-label="上下文策略模板"
              value={draft.id}
              onChange={(event) => selectProfile(event.target.value)}
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </NativeSelect>
            {!isDefaultState && (
              <Button variant="secondary" size="sm" onClick={resetDefaults}>
                <Icon name="refresh" size="sm" />
                恢复默认
              </Button>
            )}
          </div>
        </SettingRow>
        {saveError && (
          <p className="settings-save-error" role="alert">
            {saveError}
          </p>
        )}
      </section>

      <ContextSimulator
        profile={draft}
        onChangeWindowCeiling={(targetWindowTokens) => {
          const next = buildNextProfile(draftRef.current, (profile) => {
            if (targetWindowTokens > 0) profile.targetWindowTokens = targetWindowTokens;
            else delete profile.targetWindowTokens;
          });
          persistProfile(next);
        }}
        onPreviewReserve={(reserveTokens) => previewCompactSlider((step) => { step.params.reserveTokens = reserveTokens; })}
        onPreviewKeepRecent={(keepRecentTokens) => previewCompactSlider((step) => { step.params.keepRecentTokens = keepRecentTokens; })}
        onCommitSlider={flushSliderPreview}
      />

      <section className="settings-group">
        <h4>整理开关与预算</h4>
        {compact && (
          <SettingRow
            label="自动摘要"
            hint="关闭后不再调用模型生成摘要；超窗时仅由工具结果节选与窗口准入兜底。"
          >
            <Switch
              label="自动摘要"
              checked={compact.enabled}
              onCheckedChange={(enabled) => commitCompactImmediate((step) => { step.enabled = enabled; })}
            />
          </SettingRow>
        )}
        {trim && (
          <SettingRow
            label="工具结果裁剪"
            hint="输入接近上限时，优先将较早的工具正文替换为可读回的节选，不额外消耗模型预算。"
          >
            <Switch
              label="超窗时裁剪工具结果"
              checked={trim.enabled}
              onCheckedChange={(enabled) => {
                const next = buildNextProfile(draftRef.current, (profile) => {
                  const step = profile.steps.find((item) => item.kind === 'trim-tool-results');
                  if (step) step.enabled = enabled;
                });
                persistProfile(next);
              }}
            />
          </SettingRow>
        )}
        <SettingRow
          label="每任务累计预算"
          hint="普通推理与摘要共用预算，留空表示不限制。"
        >
          <div className="settings-number-field">
            <div>
              <Input
                aria-label="每任务累计 token 预算"
                aria-invalid={Boolean(budgetError)}
                aria-describedby={budgetError ? 'context-budget-error' : undefined}
                type="number"
                min="1"
                step="1"
                value={budgetInput}
                placeholder="不限制"
                onChange={(event) => handleBudgetChange(event.target.value)}
              />
              <span>token</span>
            </div>
            {budgetError && <small id="context-budget-error">{budgetError}</small>}
          </div>
        </SettingRow>
      </section>

      <LatestContextPlan agentId={agentId} active={activeProfile} />
    </div>
  );
}

/** 策略效果模拟器：按后端 15% 预留与 25% 近期保护边界，实时预览触发水位与保留空间。 */
function ContextSimulator({
  profile,
  onChangeWindowCeiling,
  onPreviewReserve,
  onPreviewKeepRecent,
  onCommitSlider,
}: {
  profile: ContextProfile;
  onChangeWindowCeiling(targetWindowTokens: number): void;
  onPreviewReserve(value: number): void;
  onPreviewKeepRecent(value: number): void;
  onCommitSlider(): void;
}) {
  const [windowPreset, setWindowPreset] = useState<ContextWindowPreset>('128000');
  const inputLimit = Number(windowPreset);
  const sim = useMemo(() => simulateContextProfile(profile, inputLimit), [profile, inputLimit]);
  const hasCompactStep = profile.steps.some((step) => step.kind === 'compact');

  const reserveRatio = Math.min(15, Math.round((sim.effectiveReserveTokens / sim.effectiveLimit) * 100));
  const keepRecentRatio = Math.min(25, Math.max(1, Math.round((sim.effectiveKeepRecentTokens / sim.effectiveLimit) * 100)));

  return (
    <section className="settings-group context-simulator" aria-label="上下文压缩策略模拟">
      <div className="context-simulator-head">
        <div>
          <h4>效果预览与水位</h4>
          <p className="settings-note">
            {sim.windowCapped
              ? `当前已启用 ${(sim.effectiveLimit / 1000).toLocaleString()}K 工作区封顶（小窗口模型仍按自身 85% 兜底）。`
              : '按参考窗口预览触发整理线与近期原文保留上限。'}
          </p>
        </div>
        <SegmentedControl
          label="参考模型窗口"
          value={windowPreset}
          options={CONTEXT_WINDOW_PRESETS}
          onChange={setWindowPreset}
        />
      </div>

      <SettingRow
        label="大窗口工作区封顶"
        hint="防止在 256K / 1M 大模型上等到 85% 才清理；小窗口模型自动按自身 85% 兜底。"
      >
        <NativeSelect
          aria-label="大窗口工作区封顶"
          value={String(profile.targetWindowTokens ?? 0)}
          onChange={(event) => onChangeWindowCeiling(Number(event.target.value))}
        >
          {WORKSPACE_CEILING_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </SettingRow>

      {sim.compactEnabled ? (
        <>
          {hasCompactStep && (
            <div className="context-simulator-sliders">
              <label className="context-slider-row">
                <div className="context-slider-meta">
                  <span>容量触发水位（预留 0%–15%）</span>
                  <strong>{100 - reserveRatio}%（预留 {reserveRatio}%）</strong>
                </div>
                <input
                  type="range"
                  aria-label="容量触发预留比例"
                  min={0}
                  max={15}
                  step={1}
                  value={reserveRatio}
                  onChange={(event) => {
                    const pct = Number(event.target.value);
                    onPreviewReserve(Math.round((sim.effectiveLimit * pct) / 100));
                  }}
                  onPointerUp={onCommitSlider}
                  onKeyUp={onCommitSlider}
                  onBlur={onCommitSlider}
                />
              </label>
              <label className="context-slider-row">
                <div className="context-slider-meta">
                  <span>近期原文保护（1%–25%）</span>
                  <strong>{keepRecentRatio}%</strong>
                </div>
                <input
                  type="range"
                  aria-label="近期原文保护比例"
                  min={1}
                  max={25}
                  step={1}
                  value={keepRecentRatio}
                  onChange={(event) => {
                    const pct = Number(event.target.value);
                    onPreviewKeepRecent(Math.max(1, Math.round((sim.effectiveLimit * pct) / 100)));
                  }}
                  onPointerUp={onCommitSlider}
                  onKeyUp={onCommitSlider}
                  onBlur={onCommitSlider}
                />
              </label>
            </div>
          )}

          <div className="context-simulator-bars">
            {(() => {
              const safeEndPct = sim.trimEnabled
                ? Math.min(100, (sim.trimTriggerTokens / sim.effectiveLimit) * 100)
                : Math.min(100, (sim.compactTriggerTokens / sim.effectiveLimit) * 100);
              const compactStartPct = Math.max(safeEndPct, Math.min(100, (sim.compactTriggerTokens / sim.effectiveLimit) * 100));
              const trimSpanPct = sim.trimEnabled ? Math.max(0, compactStartPct - safeEndPct) : 0;
              const compactSpanPct = Math.max(0, 100 - compactStartPct);
              return (
                <div className="context-sim-row">
                  <div className="context-sim-meta">
                    <span>工作区触发阶段（上限 {sim.effectiveLimit.toLocaleString()} tokens）</span>
                    <strong>LLM 摘要线 {sim.compactTriggerTokens.toLocaleString()} tokens</strong>
                  </div>
                  <div className="context-sim-track context-sim-segmented" role="img" aria-label="上下文触发阶段分段条">
                    <div className="context-sim-seg context-sim-seg-safe" style={{ width: `${safeEndPct}%` }} />
                    {trimSpanPct > 0 && (
                      <div className="context-sim-seg context-sim-seg-trim" style={{ width: `${trimSpanPct}%` }} />
                    )}
                    {compactSpanPct > 0 && (
                      <div className="context-sim-seg context-sim-seg-compact" style={{ width: `${compactSpanPct}%` }} />
                    )}
                  </div>
                  <div className="context-sim-legend">
                    <span>
                      <i className="context-sim-dot context-sim-seg-safe" />
                      安全区 0–{(sim.trimEnabled ? sim.trimTriggerTokens : sim.compactTriggerTokens).toLocaleString()}
                    </span>
                    {sim.trimEnabled && (
                      <span>
                        <i className="context-sim-dot context-sim-seg-trim" />
                        免费裁剪 {sim.trimTriggerTokens.toLocaleString()}–{sim.compactTriggerTokens.toLocaleString()}
                      </span>
                    )}
                    <span>
                      <i className="context-sim-dot context-sim-seg-compact" />
                      LLM 摘要 {sim.compactTriggerTokens.toLocaleString()}–{sim.effectiveLimit.toLocaleString()}
                    </span>
                  </div>
                </div>
              );
            })()}

            <div className="context-sim-row">
              <div className="context-sim-meta">
                <span>摘要后保留近期原文上限</span>
                <strong>{sim.effectiveKeepRecentTokens.toLocaleString()} tokens</strong>
              </div>
              <div className="context-sim-track">
                <div
                  className="context-sim-fill context-sim-keep"
                  style={{ width: `${Math.min(100, Math.max(2, keepRecentRatio))}%` }}
                />
              </div>
            </div>
          </div>

          <div className="context-plan-metrics">
            <div>
              <strong>{sim.reclaimableTokens.toLocaleString()}</strong>
              <span>最多可腾出（不含前缀与摘要）</span>
            </div>
            <div>
              <strong>{sim.reclaimRatioPercent}%</strong>
              <span>单次理论释放比例</span>
            </div>
          </div>
        </>
      ) : (
        <p className="settings-note">
          当前未启用自动摘要。{sim.trimEnabled ? `将在 ${sim.trimTriggerTokens.toLocaleString()} tokens（85%）起优先裁剪工具结果。` : '仅保留模型窗口准入检查。'}
        </p>
      )}
    </section>
  );
}

/** 仅在当前会话已产生整理事实时展示最近一次命中记录。 */
function LatestContextPlan({ agentId, active }: { agentId: string | null; active: ContextProfile }) {
  const events = useAgentStreamStore((state) => (agentId ? state.eventsByAgent[agentId] ?? EMPTY_EVENTS : EMPTY_EVENTS));
  const { plan, compactionCount, coveredMessages } = useMemo(() => {
    const entries = buildItems(events).flatMap((item) => (item.kind === 'effect' ? [item.entry] : []));
    const compactions = events.filter(
      (event) => event.fact.scope === 'turn' && event.fact.event.type === 'context.compacted',
    );
    const lastCompaction = compactions.at(-1);
    const covered =
      lastCompaction?.fact.scope === 'turn' && lastCompaction.fact.event.type === 'context.compacted'
        ? lastCompaction.fact.event.data.coveredMessageCount
        : 0;
    return {
      plan: inferenceContext(entries)?.contextPlan,
      compactionCount: compactions.length,
      coveredMessages: covered,
    };
  }, [events]);

  if (!agentId || (!plan && compactionCount === 0)) return null;
  const stale = plan ? (plan.profileId !== active.id || plan.profileRevision !== active.revision) : false;

  return (
    <section className="settings-group">
      <h4>最近一次整理记录</h4>
      {plan && (
        <>
          <div className="context-plan-metrics">
            <div><strong>{plan.beforeTokens.toLocaleString()}</strong><span>整理前估算</span></div>
            <div><strong>{plan.afterTokens.toLocaleString()}</strong><span>实际输入估算</span></div>
            <div><strong>{plan.inputLimit.toLocaleString()}</strong><span>输入额度</span></div>
          </div>
          <p className="settings-note">
            由「{plan.profileName}」处理，命中 {plan.steps.length} 个步骤。{stale ? '（该记录来自旧配置快照）' : ''}
          </p>
          {plan.steps.length > 0 && (
            <ol className="context-plan-steps">
              {plan.steps.map((step, index) => (
                <li key={`${step.stepId}-${index}`}>
                  <span className="context-step-number">{index + 1}</span>
                  <strong>{KIND_LABELS[step.kind]}</strong>
                  <span className="context-badge">{REASON_LABELS[step.reason]}</span>
                  <span>{step.beforeTokens.toLocaleString()} → {step.afterTokens.toLocaleString()} tokens</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      {compactionCount > 0 && (
        <p className="settings-note">
          本会话累计已执行 {compactionCount} 次摘要，已覆盖前 {coveredMessages} 条历史消息。
        </p>
      )}
    </section>
  );
}
