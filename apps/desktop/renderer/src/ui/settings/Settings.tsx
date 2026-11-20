import { Input, InputGroup, InputGroupAddon, InputGroupInput } from '@archer/ui';
import { settingsMatches } from '../../lib/settings-search';
import {
  BASE_THEMES,
  COLOR_THEMES,
  baseThemeDefinition,
  colorThemeDefinition,
  normalizeHex,
  resolveTheme,
  themeAccentFill,
  type Appearance,
} from '../theme/theme';
import { useSystemDark } from '../theme/system-appearance';
import { Button, Dialog, Label, NativeSelect, RadioGroup, RadioGroupItem, SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem, Switch } from '@archer/ui';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { resolveContextProfile, type ModelSettings } from '@archer/contracts';
import { SettingRow, type SettingsEditorState } from './SettingsControls';
import { ContextManagement } from './ContextManagement';
import { ModelSettingsEditor } from './ModelSettingsEditor';
import { ProviderBrowser } from './ProviderBrowser';
import { useHealth } from '../../hooks/use-runtime';
import { usePreferences, type FontSize, type SettingsSection as Section } from '../../store/preferences';
import { useWorkspaceNavigation } from '../../store/workspaces';
import { useModelSettings } from '../workspace/ComposerControls';
import { Icon, type IconName } from '@archer/ui';
import { ProjectManager } from '../navigation/ProjectManager';
import { SessionManager } from '../navigation/SessionManager';
import { shortcutLabel } from '../../lib/platform';
import { SegmentedControl } from '@archer/ui';

const SECTIONS: readonly { key: Section; label: string; icon: IconName; description: string; group: string; scope: string }[] = [
  { key: 'general', label: '通用设置', icon: 'settings', group: '使用偏好', scope: '本机偏好 · 即时保存', description: '设置新对话的默认选项与应用启动行为。' },
  { key: 'appearance', label: '外观与主题', icon: 'sun', group: '使用偏好', scope: '本机偏好 · 即时保存', description: '自定义 Archer 的外观、界面主题与强调色。' },
  { key: 'shortcuts', label: '快捷键', icon: 'terminal', group: '使用偏好', scope: '操作参考', description: '查看当前运行环境支持的快捷操作。' },
  { key: 'models', label: '模型设置', icon: 'spark', group: '模型与执行', scope: '服务端配置 · 保存后生效', description: '配置模型连接与默认选择，保存后用于后续对话。' },
  { key: 'context', label: '上下文', icon: 'list', group: '模型与执行', scope: '本机默认值 · 保存后生效', description: '调整对话整理方式和每次任务的用量预算。' },
  { key: 'providers', label: '能力来源', icon: 'drive', group: '模型与执行', scope: '当前应用 · 只读', description: '查看已接入的能力来源、用途与契约声明。' },
  { key: 'sessions', label: '对话记录', icon: 'compose', group: '工作区与记录', scope: '当前服务', description: '查找、打开和整理已有对话。' },
  { key: 'projects', label: '工作区', icon: 'folder', group: '工作区与记录', scope: '本机导航', description: '选择工作文件夹，查看关联对话。' },
  { key: 'about', label: '关于 Archer', icon: 'info', group: '产品信息', scope: '运行信息', description: '查看版本、运行环境与服务连接信息。' },
];
const GROUPS = [...new Set(SECTIONS.map(section => section.group))];
const CLEAN_EDITOR: SettingsEditorState = { dirty: false, busy: false };

export function Settings({ agentId, onAddWorkspace }: { agentId: string | null; onAddWorkspace(): void }) {
  const prefs = usePreferences();
  const query = useModelSettings();
  const returnButton = useRef<HTMLButtonElement>(null);
  const [search, setSearch] = useState('');
  const [contextDetail, setContextDetail] = useState(false);
  const [section, setSection] = useState<Section>(() => usePreferences.getState().settingsSection);
  const [modelState, setModelState] = useState(CLEAN_EDITOR);
  const [contextState, setContextState] = useState(CLEAN_EDITOR);
  const [pendingExit, setPendingExit] = useState<{ action(): void } | null>(null);
  const onModelState = useCallback((state: SettingsEditorState) => setModelState(state), []);
  const onContextState = useCallback((state: SettingsEditorState) => setContextState(state), []);
  const dirty = modelState.dirty || contextState.dirty;
  const busy = modelState.busy || contextState.busy;
  const current = SECTIONS.find(item => item.key === section)!;

  useEffect(() => {
    const origin = document.activeElement;
    returnButton.current?.focus();
    return () => {
      requestAnimationFrame(() => {
        if (origin instanceof HTMLElement && origin.isConnected) origin.focus({ preventScroll: true });
      });
    };
  }, []);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);

  // 返回应用和跨工作区跳转统一检查草稿；页面内切换分类不卸载编辑器。
  function requestExit(action = () => prefs.openSettings(false)) {
    if (busy) return;
    if (dirty) setPendingExit({ action });
    else action();
  }

  function isDirty(key: Section) {
    return key === 'models' ? modelState.dirty : key === 'context' && contextState.dirty;
  }

  const matches = SECTIONS.filter(item => settingsMatches(item, search));
  function searchSettings(value: string) {
    setSearch(value);
    const first = SECTIONS.find(item => settingsMatches(item, value));
    if (value.trim() && first) setSection(first.key);
  }

  return <section aria-label="设置工作区" className="settings-workspace" onKeyDown={event => {
    // 设置是页面而非模态；Esc 只处理搜索或内部浮层，不连带操作隐藏的检查器。
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!document.querySelector('dialog[open], [popover]:popover-open') && search) setSearch('');
    }
  }}>
    <header className="settings-workspace-bar"><span className="window-title">Archer · 设置</span></header>
    <div className="settings-shell">
      <aside className="settings-navigation">
        <Button ref={returnButton} variant="ghost" className="settings-return" disabled={busy} onClick={() => requestExit()}>
          <Icon name="arrow-left" size="sm" /><span>返回应用</span>
        </Button>
        <InputGroup className="settings-search">
          <InputGroupAddon><Icon name="search" size="sm" /></InputGroupAddon>
          <InputGroupInput type="search" aria-label="搜索设置" placeholder="搜索设置…" value={search} onChange={event => searchSettings(event.target.value)} />
        </InputGroup>
        {/* 分类切换是页面级导航：复用包内 Sidebar 菜单原语，选中状态由 aria-current 与 isActive 同步表达。 */}
        <nav aria-label="设置分类">
          {GROUPS.filter(group => matches.some(item => item.group === group)).map(group => <SidebarGroup
            className="settings-nav-group"
            key={group}
            role="group"
            aria-label={group}
          >
            <SidebarMenu>
              {matches.filter(item => item.group === group).map(item => <SidebarMenuItem key={item.key}>
                <SidebarMenuButton
                  isActive={section === item.key}
                  aria-current={section === item.key ? 'page' : undefined}
                  onClick={() => setSection(item.key)}
                >
                  <Icon name={item.icon} size="sm" />
                  <span>{item.label}</span>
                  {isDirty(item.key) && <span className="settings-dirty-dot" role="img" aria-label="有未保存的修改" />}
                </SidebarMenuButton>
              </SidebarMenuItem>)}
            </SidebarMenu>
          </SidebarGroup>)}
          {!matches.length && <p className="settings-no-results" role="status">没有匹配的设置。</p>}
        </nav>
        <p className="settings-scope">
          <Icon name={current.scope.includes('本机') ? 'monitor' : 'info'} size="xs" />
          {current.scope}
        </p>
      </aside>
      <div className="settings-content-area"><div className="settings-main">
        <header className="settings-page-header">
          <div className="settings-mobile-category">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => requestExit()}><Icon name="arrow-left" size="sm" />返回应用</Button>
            <label htmlFor="settings-category">设置</label>
            <NativeSelect id="settings-category" value={section} onChange={event => setSection(event.target.value as Section)}>
              {SECTIONS.map(item => <option key={item.key} value={item.key}>{item.label}{isDirty(item.key) ? ' · 未保存' : ''}</option>)}
            </NativeSelect>
          </div>
          <div className="settings-page-heading">
            <div>
              {section === 'context' && contextDetail && <Button variant="link" size="sm" className="settings-detail-back" onClick={() => setContextDetail(false)}><Icon name="arrow-left" size="sm" />返回上下文</Button>}
              <h3 className="settings-title" id="settings-page-title">{section === 'context' && contextDetail ? '整理策略' : current.label}</h3><p className="settings-description">{current.description}</p></div>
          </div>
        </header>
        {/* 编辑器保持挂载，切换分类只切换可见性，未提交的草稿与错误反馈不丢失。 */}
        <div className="settings-editor-page" hidden={section !== 'models'} aria-label="模型设置内容">
          <ModelSettingsEditor onStateChange={onModelState} />
        </div>
        <div className="settings-editor-page" hidden={section !== 'context' || !contextDetail} aria-label="上下文管理内容">
          <ContextManagement agentId={agentId} onStateChange={onContextState} />
        </div>
        <div className="settings-editor-page" hidden={section !== 'appearance'} aria-label="外观与主题内容">
          <AppearancePreferences />
        </div>
        {section === 'context' && !contextDetail && <div className="settings-scroll">
          <section className="settings-group">
            <h4>对话整理</h4>
            <SettingRow label="整理策略" hint={`当前生效：${resolveContextProfile(prefs.activeContextProfileId, prefs.customContextProfiles).name}。调整摘要、触发条件和任务预算。`}>
              <Button variant="secondary" onClick={() => setContextDetail(true)}>编辑策略</Button>
            </SettingRow>
            {contextState.dirty && <p className="settings-note">策略详情中有未保存的修改。</p>}
          </section>
        </div>}
        {section !== 'models' && section !== 'context' && section !== 'appearance' && <div className="settings-scroll" key={section}>
          {section === 'general' && <GeneralPreferences models={query.data} modelsFailed={query.isError} onAddWorkspace={() => requestExit(onAddWorkspace)} onModels={() => setSection('models')} />}
          {section === 'shortcuts' && <ShortcutReference />}
          {section === 'providers' && <ProviderBrowser />}
          {section === 'sessions' && <SessionManager onLeave={requestExit} />}
          {section === 'projects' && <ProjectManager onAddWorkspace={() => requestExit(onAddWorkspace)} onLeave={requestExit} />}
          {section === 'about' && <AboutPanel />}
        </div>}
      </div></div>
    </div>
    {pendingExit && <UnsavedSettingsDialog
      sections={[modelState.dirty && '模型设置', contextState.dirty && '上下文管理'].filter(Boolean).join('、')}
      onContinue={() => setPendingExit(null)}
      onDiscard={() => {
        const action = pendingExit.action;
        setPendingExit(null);
        action();
      }}
    />}
  </section>;
}

/** 使用原生模态保证确认期间焦点留在选择内，Esc 返回编辑，不默默丢弃草稿。 */
function UnsavedSettingsDialog({ sections, onContinue, onDiscard }: { sections: string; onContinue(): void; onDiscard(): void }) {
  const continueButton = useRef<HTMLButtonElement>(null);
  return <Dialog
    open
    onOpenChange={() => onContinue()}
    title="还有未保存的修改"
    description={`${sections}的修改尚未保存。继续编辑可保留草稿，放弃后将使用已保存的配置。`}
    size="small"
    initialFocus={continueButton}
    className="settings-unsaved-dialog"
    actions={<>
      <Button variant="secondary" onClick={onDiscard}>放弃修改并离开</Button>
      <Button ref={continueButton} variant="default" onClick={onContinue}>继续编辑</Button>
    </>}
  />;
}

/** 固定行为用事实值展示；可编辑偏好即时写入本机，不冒充服务端配置。 */
function GeneralPreferences({ models, modelsFailed, onAddWorkspace, onModels }: {
  models?: ModelSettings;
  modelsFailed: boolean;
  onAddWorkspace(): void;
  onModels(): void;
}) {
  const prefs = usePreferences();
  const workspace = useWorkspaceNavigation();
  const recent = workspace.recent;
  const modelExists = !prefs.model || models?.models.some(model => JSON.stringify([model.provider, model.id]) === prefs.model);
  return <>
    <section className="settings-group">
      <h4>新对话默认值</h4>
      <SettingRow label="工作区" hint={workspace.selected || '选择新对话使用的文件夹。'}>
        {recent.length ? <NativeSelect aria-label="默认工作区" value={workspace.selected ?? ''} onChange={event => workspace.select(event.target.value)}>
          {!workspace.selected && <option value="">请选择工作区</option>}
          {recent.map(root => <option key={root} value={root}>{root}</option>)}
        </NativeSelect> : <Button variant="secondary" onClick={onAddWorkspace}><Icon name="folder-plus" size="sm" />选择文件夹</Button>}
      </SettingRow>
      <SettingRow label="模型" hint={modelsFailed ? '模型列表加载失败，可前往模型设置重试。' : !modelExists ? '此前选择的模型已不可用，请重新选择。' : '用于后续发送的任务，可在对话输入区临时切换。'}>
        {modelsFailed ? <Button variant="secondary" onClick={onModels}>打开模型设置</Button> : <NativeSelect aria-label="默认模型" value={prefs.model} disabled={!models} onChange={event => prefs.setModel(event.target.value)}>
          <option value="">{models ? '使用服务默认模型' : '正在读取模型…'}</option>
          {!modelExists && <option value={prefs.model} disabled>此前选择的模型已不可用</option>}
          {[...new Set(models?.models.map(model => model.provider))].map(provider => <optgroup key={provider} label={provider}>
            {models?.models.filter(model => model.provider === provider).map(model => <option key={model.id} value={JSON.stringify([provider, model.id])}>{model.name || model.id}</option>)}
          </optgroup>)}
        </NativeSelect>}
      </SettingRow>
      <SettingRow label="文件访问" hint="新会话的文件工具访问范围；命令授权由任务单独选择。">
        <SegmentedControl label="默认文件访问" value={prefs.workspaceAccess}
          options={[{ value: 'read', label: '只读' }, { value: 'edit', label: '读取与编辑' }]}
          onChange={value => prefs.setWorkspaceAccess(value === 'read' ? 'read' : 'edit')} />
      </SettingRow>
    </section>
    <section className="settings-group">
      <h4>启动与语言</h4>
      <SettingRow label="启动时打开" hint="已有会话链接时，优先打开链接指定的会话。">
        <SegmentedControl label="启动时打开" value={prefs.startup}
          options={[{ value: 'last', label: '上次对话' }, { value: 'new', label: '新对话' }]}
          onChange={value => prefs.setStartup(value === 'new' ? 'new' : 'last')} />
      </SettingRow>
      <SettingRow label="界面语言"><span className="settings-static-value">简体中文</span></SettingRow>
    </section>
    <section className="settings-group">
      <h4>记录保存</h4>
      <SettingRow label="自动保存对话" hint="对话与执行记录由服务持续保存，便于查看和恢复。">
        <span className="settings-static-value"><Icon name="check" size="sm" />始终开启</span>
      </SettingRow>
    </section>
  </>;
}

function ShortcutReference() {
  const shortcuts = [['新建对话', shortcutLabel('N')], ['搜索对话', shortcutLabel('K')]];
  if (window.archerDesktop) {
    shortcuts.push(['打开工作区', shortcutLabel('O')], ['切换侧栏', shortcutLabel('B')], ['切换工作台', shortcutLabel('Shift+I')]);
    if (window.archerDesktop.platform === 'darwin') shortcuts.push(['打开设置', shortcutLabel(',')]);
  }
  return <>
    <section className="settings-group"><h4>工作台</h4>
      <div className="settings-shortcuts">{shortcuts.map(([label, key]) => <div key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</div>
    </section>
    <section className="settings-group"><h4>对话输入</h4>
      <div className="settings-shortcuts"><div><span>发送消息</span><kbd>Enter</kbd></div><div><span>输入换行</span><kbd>Shift + Enter</kbd></div></div>
    </section>
  </>;
}
const APPEARANCE_OPTIONS: readonly { value: Appearance; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
];

/** 外观设置中心：三个维度互不锁定，底部实时预览直接复用当前主题 Token。 */
function AppearancePreferences() {
  const prefs = usePreferences();
  const systemDark = useSystemDark();
  const resolved = resolveTheme({
    appearance: prefs.appearance,
    baseTheme: prefs.baseTheme,
    colorTheme: prefs.colorTheme,
    customAccent: prefs.customAccent,
  }, systemDark).appearance;
  const base = baseThemeDefinition(prefs.baseTheme);
  const accentLabel = prefs.colorTheme === 'custom'
    ? `自定义 ${prefs.customAccent}`
    : colorThemeDefinition(prefs.colorTheme).label;
  const accentFill = themeAccentFill(prefs.colorTheme, prefs.customAccent, resolved);

  return <div className="appearance-page">
    <div className="appearance-page-scroll">
      <section className="settings-group">
        <h4>外观模式</h4>
        <p className="settings-group-hint">
          {prefs.appearance === 'system'
            ? `跟随操作系统；当前按${resolved === 'dark' ? '深色' : '浅色'}显示。`
            : '决定窗口、面板与文字的明暗，不改变界面主题与强调色。'}
        </p>
        <div className="appearance-mode">
          <SegmentedControl<Appearance>
            label="外观模式"
            value={prefs.appearance}
            options={APPEARANCE_OPTIONS}
            onChange={prefs.setAppearance}
          />
        </div>
      </section>

      <section className="settings-group">
        <h4>界面主题</h4>
        <p className="settings-group-hint">决定窗口、侧栏与面板的基础色调，可与任意强调色自由组合。</p>
        <RadioGroup
          className="base-theme-options"
          aria-label="界面主题"
          value={prefs.baseTheme}
          onValueChange={value => prefs.setBaseTheme(value as (typeof BASE_THEMES)[number]['id'])}
        >
          {BASE_THEMES.map(theme => {
            const preview = theme.preview[resolved];
            return <Label
              key={theme.id}
              className="base-theme-option"
              data-checked={prefs.baseTheme === theme.id ? '' : undefined}
              style={{
                '--theme-preview-bg': preview.background,
                '--theme-preview-panel': preview.panel,
                '--theme-preview-border': preview.border,
              } as CSSProperties}
            >
              <RadioGroupItem value={theme.id} className="sr-only" />
              <span className="base-theme-swatches" aria-hidden="true">
                <span className="base-theme-swatch is-bg" />
                <span className="base-theme-swatch is-panel" />
                <span className="base-theme-swatch is-border" />
              </span>
              <span className="base-theme-copy">
                <span className="base-theme-title">{theme.label}</span>
                <span className="base-theme-description">{theme.description}</span>
              </span>
              {prefs.baseTheme === theme.id && <Icon name="check" size="sm" className="base-theme-check" />}
            </Label>;
          })}
        </RadioGroup>
      </section>

      <section className="settings-group">
        <h4>强调色系</h4>
        <p className="settings-group-hint">用于按钮、选中项、焦点和少量活动标识，不替换中性背景。</p>
        <RadioGroup
          className="accent-list"
          aria-label="强调色系"
          value={prefs.colorTheme}
          onValueChange={value => prefs.setColorTheme(value as (typeof COLOR_THEMES)[number]['id'] | 'custom')}
        >
          {COLOR_THEMES.map(theme => (
            <Label
              key={theme.id}
              className="accent-row"
              data-checked={prefs.colorTheme === theme.id ? '' : undefined}
            >
              <RadioGroupItem value={theme.id} className="sr-only" />
              <span
                className="accent-row-dot"
                style={{ backgroundColor: themeAccentFill(theme.id, prefs.customAccent, resolved) }}
                aria-hidden="true"
              >
                {prefs.colorTheme === theme.id && <Icon name="check" size="xs" />}
              </span>
              <span className="accent-row-copy">
                <span className="accent-row-name">{theme.label}</span>
                <span className="accent-row-description">{theme.description}</span>
              </span>
              <span className="accent-row-hex">{theme.accent[resolved].toUpperCase()}</span>
            </Label>
          ))}
          <Label className="accent-row" data-checked={prefs.colorTheme === 'custom' ? '' : undefined}>
            <RadioGroupItem value="custom" className="sr-only" />
            <span className="accent-row-dot" style={{ backgroundColor: accentFill }} aria-hidden="true">
              {prefs.colorTheme === 'custom' && <Icon name="check" size="xs" />}
            </span>
            <span className="accent-row-copy">
              <span className="accent-row-name">Custom</span>
              <span className="accent-row-description">自定义强调色</span>
            </span>
            <span className="accent-row-hex">{prefs.customAccent.toUpperCase()}</span>
          </Label>
        </RadioGroup>
        {prefs.colorTheme === 'custom' && <CustomAccentEditor value={prefs.customAccent} onChange={prefs.setCustomAccent} />}
      </section>

      <section className="settings-group">
        <h4>文字大小</h4>
        <SettingRow label="界面字号" hint="应用于整个界面，不改变主题颜色。">
          <SegmentedControl<FontSize>
            label="界面字号"
            value={prefs.fontSize}
            options={[
              { value: 'small', label: '小' },
              { value: 'medium', label: '中' },
              { value: 'large', label: '大' },
            ]}
            onChange={prefs.setFontSize}
          />
        </SettingRow>
      </section>

      <section className="settings-group">
        <h4>对话</h4>
        <SettingRow label="代码高亮" hint="用语法配色帮助阅读。">
          <Switch label="显示代码高亮" checked={prefs.codeHighlight} onCheckedChange={prefs.setCodeHighlight} />
        </SettingRow>
        <SettingRow label="代码行号" hint="在代码块旁显示行号。">
          <Switch label="显示行号" checked={prefs.lineNumbers} onCheckedChange={prefs.setLineNumbers} />
        </SettingRow>
      </section>

      <div className="appearance-reset">
        <div className="appearance-reset-copy">
          <strong>恢复默认外观</strong>
          <span>深色 · Graphite · Graphite Iris</span>
        </div>
        <Button variant="secondary" onClick={prefs.resetAppearance}>恢复默认</Button>
      </div>
    </div>
    <AppearanceLivePreview combo={`${base.label} · ${accentLabel}`} />
  </div>;
}

/** HEX 输入只在完整合法时写入偏好；颜色选择器与文本输入共享同一校验。 */
function CustomAccentEditor({ value, onChange }: { value: string; onChange(hex: string): void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const valid = normalizeHex(draft);
  return <div className="accent-custom-editor">
    <label className="accent-custom-swatch" style={{ '--accent-custom-preview': valid ?? value } as CSSProperties}>
      <input
        type="color"
        aria-label="选择自定义强调色"
        value={valid ?? value}
        onChange={event => onChange(event.target.value)}
      />
    </label>
    <label className="accent-custom-field">
      <span>HEX</span>
      <Input
        aria-label="自定义强调色 HEX"
        aria-invalid={!valid}
        value={draft}
        maxLength={7}
        spellCheck={false}
        onChange={event => {
          const next = event.target.value;
          setDraft(next);
          const hex = normalizeHex(next);
          if (hex) onChange(hex);
        }}
        onBlur={() => {
          if (!normalizeHex(draft)) setDraft(value);
        }}
      />
    </label>
    <span className={`accent-custom-hint ${valid ? '' : 'is-error'}`} role="status">
      {valid ? '输入完整色值即可即时应用' : '请输入 #RRGGBB'}
    </span>
  </div>;
}

/** 实时预览复用真实主题 Token；组合名称只做说明，不参与配色计算。 */
function AppearanceLivePreview({ combo }: { combo: string }) {
  const [open, setOpen] = useState(true);
  return <aside className="appearance-preview-dock" aria-label="主页实时预览">
    <header className="appearance-preview-bar">
      <Button variant="ghost" size="sm" className="appearance-preview-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size="sm" />
        <span>主页实时预览</span>
      </Button>
      <span className="appearance-preview-combo">{combo}</span>
    </header>
    {open && <div className="theme-preview" aria-hidden="true">
      <div className="theme-preview-rail">
        <span className="theme-preview-mark" />
        <span className="theme-preview-rail-icon is-active"><Icon name="compose" size="sm" /></span>
        <span className="theme-preview-rail-icon"><Icon name="drive" size="sm" /></span>
        <span className="theme-preview-rail-icon"><Icon name="settings" size="sm" /></span>
      </div>
      <div className="theme-preview-nav">
        <span className="theme-preview-brand">Archer</span>
        <span className="theme-preview-nav-row is-selected"><Icon name="compose" size="xs" />新对话</span>
        <span className="theme-preview-nav-row"><span className="theme-preview-dot is-running" />支付回调修复</span>
        <span className="theme-preview-nav-row"><span className="theme-preview-dot" />上下文整理</span>
        <span className="theme-preview-nav-label">今天</span>
        <span className="theme-preview-nav-row is-muted">检查器布局</span>
      </div>
      <div className="theme-preview-main">
        <div className="theme-preview-heading">
          <span>支付回调修复</span>
          <span className="theme-preview-badge is-running">运行中</span>
        </div>
        <div className="theme-preview-card">
          <span className="theme-preview-avatar">A</span>
          <div className="theme-preview-copy">
            <span className="theme-preview-agent">Archer Agent</span>
            <span className="theme-preview-line">把会话列表整理成按轮次分组，并保留执行详情。</span>
          </div>
        </div>
        <div className="theme-preview-actions">
          {/* 预览用真实按钮渲染，主题切换时反映的才是生产外观；预览不可聚焦。 */}
          <Button variant="default" size="sm" tabIndex={-1} className="theme-preview-action">继续执行</Button>
          <Button variant="secondary" size="sm" tabIndex={-1} className="theme-preview-action">查看详情</Button>
          <span className="theme-preview-link">强调文字</span>
        </div>
        <div className="theme-preview-selected">
          <Icon name="check" size="xs" />
          <span>已选中的上下文条目</span>
        </div>
        <div className="theme-preview-input">
          <span>描述下一步任务…</span>
          <kbd>↵</kbd>
        </div>
        <div className="theme-preview-tags">
          <span className="theme-preview-badge is-success">成功</span>
          <span className="theme-preview-badge is-warning">等待</span>
          <span className="theme-preview-badge is-danger">失败</span>
        </div>
      </div>
    </div>}
  </aside>;
}

/** 关于页保留最近读取的运行信息，同时单独呈现当前连接失败，避免把缓存误报为健康。 */
function AboutPanel() {
  const health = useHealth();
  const desktop = window.archerDesktop;
  const info = health.data;
  const pending = health.isError ? '无法连接' : '读取中…';
  const inference = info ? (info.inference === 'pi' ? '连接模型服务' : '模拟响应（调试）') : pending;
  const platform = desktop?.platform === 'darwin' ? 'macOS'
    : desktop?.platform === 'win32' ? 'Windows'
    : desktop?.platform === 'linux' ? 'Linux' : '浏览器';
  return <>
    <section className="settings-group">
      <div className="about-brand">
        <span className="archer-mark" aria-hidden="true" />
        <div><strong>Archer Harness</strong><span>Agent 会话工作台</span></div>
      </div>
      <div className="about-facts">
        <div><span>版本</span><span>{info?.version ?? pending}</span></div>
        <div><span>推理方式</span><span>{inference}</span></div>
        <div><span>运行平台</span><span>{platform}</span></div>
        <div><span>服务地址</span><span>{desktop?.apiUrl || window.location.origin}</span></div>
      </div>
    </section>
    <section className="settings-group">
      <h4>服务连接</h4>
      <SettingRow
        label={health.isError ? '暂时无法连接' : health.isPending ? '正在检查连接' : '服务已连接'}
        hint={health.isError ? health.error.message : '版本与推理方式来自当前服务。'}
      >
        <Button variant="secondary" disabled={health.isFetching} onClick={() => void health.refetch()}>
          <Icon name="refresh" size="sm" />
          {health.isFetching ? '检查中…' : '重新检查'}
        </Button>
      </SettingRow>
    </section>
  </>;
}
