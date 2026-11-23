import { useRef, useState } from 'react';
import type { AuthorizationConfirmation } from '../../lib/authorization';
import { FullAccessDialog } from './FullAccessDialog';
import { modelKey, selectedModel, selectedReasoning, REASONING_LABELS } from '../../lib/model-selection';
import { useQuery } from '@tanstack/react-query';
import { client } from '../../lib/api';
import type { CommandMode, ReasoningLevel } from '@archer/contracts';
import { usePreferences } from '../../store/preferences';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Icon,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@archer/ui';
export function useModelSettings() {
  return useQuery({
    queryKey: ['model-settings'],
    queryFn: () => client.modelSettings(),
    retry: false,
    staleTime: 10000
  });
}
export function ComposerControls({
  disabled = false,
  workspace,
  commandMode,
  onCommandModeChange,
  shellDisabled = false,
  authorizationTarget
}: {
  commandMode: CommandMode | 'disabled';
  onCommandModeChange(mode: CommandMode, confirmation?: AuthorizationConfirmation | null): void;
  authorizationTarget?: AuthorizationConfirmation;
  disabled?: boolean;
  workspace?: string;
  shellDisabled?: boolean;
}) {
  const controls = useRef<HTMLDivElement>(null);
  function closeConfirmation() {
    setConfirmation(null);
    // 等模态卸载和浏览器恢复焦点结束后，再回到可见入口。
    requestAnimationFrame(() => controls.current?.querySelector<HTMLButtonElement>('.command-picker')?.focus());
  }
  const [confirmation, setConfirmation] = useState<{ target: AuthorizationConfirmation | null } | null>(null);
  const prefs = usePreferences();
  const settings = useModelSettings();
  const models = settings.data?.mode === 'pi' ? settings.data.models : [];
  const chosen = selectedModel(prefs.model, settings.data);
  const reasoning = chosen ? selectedReasoning(chosen, prefs.reasoningByModel) : 'off';
  const current = models.some(m => JSON.stringify([m.provider, m.id]) === prefs.model) ? prefs.model : '';
  const providers = [...new Set(models.map(model => model.provider))];
  const defaultModel = settings.data?.mode === 'mock' ? 'Mock 演示模型' : settings.isError ? '模型设置不可用' : '默认模型';
  // 收起状态由 items 提供名称，无需等浮层挂载后再取值。
  // 默认项用显式哨兵值：空字符串会被 Base UI 视为未选择，文字会落到占位态。
  const modelItems = [{ value: 'default', label: defaultModel }, ...models.map(model => ({ value: JSON.stringify([model.provider, model.id]), label: model.name }))];
  const modelValue = current || 'default';
  const levels = chosen?.reasoningLevels ?? ['off' as const];
  return <div ref={controls} className="composer-controls">
  {confirmation && <FullAccessDialog target={confirmation.target} onClose={closeConfirmation} onConfirm={() => {
    const captured = confirmation.target;
    setConfirmation(null);
    onCommandModeChange('full', captured);
  }} />}
  <Select items={modelItems} value={modelValue} disabled={disabled || settings.isError} onValueChange={value => prefs.setModel(value === 'default' || value == null ? '' : String(value))}>
    <SelectTrigger size="sm" className="composer-picker" aria-label="选择模型" title={models.find(model => JSON.stringify([model.provider, model.id]) === current)?.name ?? '默认模型'}>
      <Icon name="spark" size="sm" />
      <SelectValue />
    </SelectTrigger>
    <SelectContent side="top" align="start" alignItemWithTrigger={false} className="composer-select-content">
      <SelectItem value="default">{defaultModel}</SelectItem>
      {providers.map(provider => <SelectGroup key={provider}>
        <SelectLabel>{provider}</SelectLabel>
        {models.filter(model => model.provider === provider).map(model => <SelectItem key={model.id} value={JSON.stringify([provider, model.id])}>{model.name}</SelectItem>)}
      </SelectGroup>)}
    </SelectContent>
  </Select>
  <Select items={levels.map(level => ({ value: level, label: REASONING_LABELS[level] }))} value={reasoning} disabled={disabled || !chosen || levels.length <= 1} onValueChange={value => { if (chosen && value != null) prefs.setReasoning(modelKey(chosen), String(value) as ReasoningLevel); }}>
    <SelectTrigger size="sm" className="composer-picker reasoning-picker" aria-label="推理等级" title={chosen && levels.length > 1 ? '为当前模型选择思考深度；更高等级通常需要更多时间和用量。设置用于后续发送的任务。' : '当前模型不支持可调推理等级'}>

      <SelectValue />
    </SelectTrigger>
    <SelectContent side="top" align="start" alignItemWithTrigger={false} className="composer-select-content">
      {levels.map(level => <SelectItem key={level} value={level}>{REASONING_LABELS[level]}</SelectItem>)}
    </SelectContent>
  </Select>
  <CommandModePicker currentTask={Boolean(authorizationTarget)} workspace={workspace} value={commandMode} disabled={disabled || shellDisabled} onChange={mode => {
    if (mode === 'full' && commandMode !== 'full') setConfirmation({ target: authorizationTarget ? { ...authorizationTarget } : null });
    else onCommandModeChange(mode);
  }} />
</div>;
}

/** 命令模式是单选菜单，复用官方下拉菜单的键盘导航，选择完全访问仍进入原确认流程。 */
function CommandModePicker({ value, disabled, onChange, workspace, currentTask }: {
  currentTask: boolean;
  workspace?: string;
  value: CommandMode | 'disabled';
  disabled: boolean;
  onChange(value: CommandMode): void;
}) {
  const options = [
    { value: 'ask', label: '每次询问', description: '执行命令前由你确认' },
    { value: 'auto', label: '自动审批', description: '仅自动放行固定规则允许的命令' },
    { value: 'full', label: '完全访问', description: '命令不再逐条询问，使用宿主权限' },
  ] as const;
  return <DropdownMenu>
    <DropdownMenuTrigger
      className="composer-picker command-picker"
      disabled={disabled}
      aria-label={currentTask ? '当前任务命令授权' : '项目命令授权'}
      title={`当前工作区：${workspace ?? '未选择'}。命令使用宿主权限。`}
    >
      <Icon name="shield" size="sm" />
      {options.find(option => option.value === value)?.label ?? '命令：关闭'}
      <Icon name="chevron-down" size="xs" className="cn-select-trigger-icon" />
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="start" className="command-mode-menu">
      <DropdownMenuRadioGroup value={value} onValueChange={next => onChange(next as CommandMode)}>
        {options.map(option => <DropdownMenuRadioItem key={option.value} value={option.value}>
          <span className="command-mode-copy"><strong>{option.label}</strong><small>{option.description}</small></span>
        </DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
      <p className="command-mode-scope"><Icon name="info" size="xs" />{currentTask ? '提交成功后影响当前任务，并保存为此项目后续任务的默认模式' : '保存为此项目的默认模式，用于各对话后续发送的任务'}</p>
    </DropdownMenuContent>
  </DropdownMenu>;
}
