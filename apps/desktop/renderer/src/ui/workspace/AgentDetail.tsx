import { Input } from '@archer/ui';
import { CurrentPlan } from './CurrentPlan';
import { ComposerAttachmentHeader, DraftComposerSendButton, DraftComposerTextarea } from './ComposerPrompt';
import { composerInput } from '../../lib/composer-input';
import { taskOptions } from '../../lib/task-options';
import { messageMode, submitMessage } from '../../lib/message-submission';
import { PendingInteraction } from './PendingInteraction';
import { QueuePanel } from './QueuePanel';
import { useSubmissions, type Submission } from '../../store/submissions';
import { useWorkbench, type WorkbenchView } from '../../store/workbench';
import { clearSessionDraft } from '../../store/drafts';
import { useProjectPreferences } from '../../store/project-preferences';
import { ComposerControls, useModelSettings } from './ComposerControls';
import { usePreferences, type WorkspaceAccess } from '../../store/preferences';
import { configureAuthorization, type AuthorizationConfirmation } from '../../lib/authorization';
import {
  Button,
  Icon,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputTools,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SidebarTrigger,
  Tabs,
  Tooltip,
  ScrollArea,
  useSidebar,
  type PromptInputMessage,
} from '@archer/ui';
import { Workbench, WorkbenchHome, type WorkbenchEntry } from '../panels/Workbench';
import { SessionOverview } from '../panels/SessionOverview';
import { ApiError } from '@archer/client';
import { useQueryClient } from '@tanstack/react-query';
import { type CommandMode } from '@archer/contracts';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSessionRemoval } from '../navigation/SessionRemoval';
import { useAbortAgent, useAgentEvents, useAgentTurns, useInferenceProgress, useAgentState, useClearQueue, useFollowUpMessage, useRenameAgent, useResumeQueue, useSendMessage, useSteerMessage } from '../../hooks/use-runtime';
import { exportSession } from '../../lib/export';
import { turnNavEntries } from '../../lib/turn-nav';
import { useAgentStreamStore } from '../../store/agent-stream';
import { buildItems } from '../../lib/conversation';
import { EventTimeline } from './EventTimeline';
import { EventPanel } from '../panels/EventPanel';
import { ContextPanel } from '../panels/ContextPanel';
import { taskChanges } from '../../lib/task-insights';
import { ChangesPanel } from '../panels/ChangesPanel';
import { WorkspaceGitPanel } from '../panels/WorkspaceGitPanel';
import { EXECUTION_LABELS, TURN_STATUS_LABELS } from '../../lib/labels';
type Mode = 'send' | 'steer' | 'followUp';
const LABELS = {
  send: '发送',
  steer: '补充当前任务',
  followUp: '排队下一任务'
};
export function AgentDetail({
  agentId,
  onRemoved,
  onNew
}: {
  agentId: string;
  onRemoved(): void;
  onNew(): void;
}) {
  const queryClient = useQueryClient();
  const stateQuery = useAgentState(agentId);
  const [reconnectVersion, setReconnectVersion] = useState(0);
  const eventWindow = useAgentEvents(agentId, stateQuery.data?.seq, reconnectVersion);
  const events = eventWindow.events;
  const [changesTurn, setChangesTurn] = useState<{ agentId: string; turnId: string; path?: string } | null>(null);
  // 只保存任务身份；新事实到达后重新投影，避免右栏停留在旧结果快照。
  const changeEntries = useMemo(() => {
    const entries = buildItems(events).flatMap(item => item.kind === 'effect' ? [item.entry] : []);
    const selectedTurn = changesTurn?.agentId === agentId ? changesTurn.turnId : entries.at(-1)?.turnId;
    return entries.filter(entry => entry.turnId === selectedTurn);
  }, [events, changesTurn, agentId]);
  // 只在点击时更换定位对象；流式事件更新沿用同一引用，不会覆盖用户在阅读区的手动选择。
  const changesFocus = useMemo(() => changesTurn?.agentId === agentId && changesTurn.path
    ? { turnId: changesTurn.turnId, path: changesTurn.path }
    : undefined, [changesTurn, agentId]);
  const turnIndex = useAgentTurns(agentId);
  const progress = useInferenceProgress(agentId, reconnectVersion);
  const streamError = useAgentStreamStore(s => s.errorsByAgent[agentId]);
  const send = useSendMessage(agentId);
  const steer = useSteerMessage(agentId);
  const followUp = useFollowUpMessage(agentId);
  const abort = useAbortAgent(agentId);
  const resume = useResumeQueue(agentId);
  const clear = useClearQueue(agentId);
  const removal = useSessionRemoval(agentId, stateQuery.data?.title ?? '会话', onRemoved);
  const rename = useRenameAgent(agentId);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const cancelRename = useRef(false);
  const [exporting, setExporting] = useState<'markdown' | 'json' | null>(null);
  const savedCommandMode = useProjectPreferences(state => state.commandModes[stateQuery.data?.workspace?.cwd ?? '']);
  const setCommandMode = (mode: CommandMode) => {
    const root = stateQuery.data?.workspace?.cwd;
    if (root) useProjectPreferences.getState().setCommandMode(root, mode);
  };
  const [updatingAuthorization, setUpdatingAuthorization] = useState(false);
  // 只撤下服务端已确认批准的等待项，不把点击或请求中当作授权成功。
  const [approvedPending, setApprovedPending] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const submission = useSubmissions(state => state.messages[agentId]);
  const setSubmission = (request: Submission | null) => useSubmissions.getState().setMessage(agentId, request);
  const [expandedPending, setExpandedPending] = useState<string | null>(null);
  const [preferred, setPreferred] = useState<Mode>('followUp');
  const prefs = usePreferences();
  const { state: sidebarState } = useSidebar();
  const modelSettings = useModelSettings();
  const [error, setError] = useState('');
  const {
    inspectorOpen: inspect,
    setInspectorOpen: setInspect,
    inspectorWidth,
    setInspectorWidth,
    inspectorView,
    setInspectorView,
  } = useWorkbench();
  // 拖动过程只更新引用，避免逐帧写入持久化状态并重绘整个会话。
  const pendingInspectorWidth = useRef(inspectorWidth);
  // 打开工作台并定位阅读对象；收起后入口仍回到顶栏同一按钮。
  const openWorkbench = (view: WorkbenchView) => {
    setInspectorView(view);
    setInspect(true);
  };
  const [selectedInvocation, setSelectedInvocation] = useState<string>();
  useEffect(() => {
    // 选择只属于当前会话，不携带到另一个 Agent 的事件窗口。
    setSelectedInvocation(undefined);
  }, [agentId]);
  const [centerView, setCenterView] = useState<'conversation' | 'activity' | 'context'>('conversation');
  // 右栏文件变更由自身提供收起操作；会话页只负责打开它并定位到对应任务。
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(false);
  // 专注模式不写入侧栏偏好；退出最大化后恢复原来的工作区布局。
  useEffect(() => {
    if (!maximized) setFocused(false);
  }, [maximized]);
  const scroll = useRef<HTMLDivElement>(null);
  const followScroll = useRef(true);
  const prependAnchor = useRef<{ height: number; top: number } | null>(null);
  const pendingJump = useRef<string | null>(null);
  const [locating, setLocating] = useState<string | null>(null);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const state = stateQuery.data;
  // SSE 的终态事实可能先于状态查询刷新；旧快照不能继续提供该任务的交互入口。
  const snapshotTurn = state?.activeTurn;
  const active = snapshotTurn && !events.some(event => event.fact.scope === 'turn'
    && event.fact.turnId === snapshotTurn.turnId
    && ['turn.completed', 'turn.failed', 'turn.cancelled'].includes(event.fact.event.type))
    ? snapshotTurn : undefined;
  const showComposer = !active?.pending || expandedPending === `${agentId}:${active.pending.effectId}`;
  const queue = state?.queuedInputs ?? [];
  const paused = state?.queuePaused === true;
  const cancelling = active?.status === 'cancelling' || abort.isPending;
  const mode = submission?.mode ?? messageMode(Boolean(active), cancelling, queue.length, preferred);
  const busy = preparing || send.isPending || steer.isPending || followUp.isPending || resume.isPending || clear.isPending || abort.isPending;
  const queueDisabled = busy || Boolean(submission) || state?.execution !== 'ready' || cancelling;
  const sendLabel = submission ? '重试提交' : paused && mode === 'send' ? '发送并恢复队列' : LABELS[mode];
  const workspace = state?.workspace?.cwd ?? '工作区';
  // 工作台首页只报已确认事实：文件数来自当前任务已加载的工具回执。
  const changedFiles = useMemo(() => new Set(taskChanges(changeEntries).map(change => change.path)).size, [changeEntries]);
  const workbenchEntries: readonly WorkbenchEntry[] = [
    { view: 'review', icon: 'file', title: '打开审阅', description: '查看本轮工具记录的文件增删行，无需 Git', meta: changedFiles ? `${changedFiles} 个文件` : '暂无变更' },
    { view: 'workspace', icon: 'git-branch', title: '打开工作区', description: '查看本地 Git 未提交改动，与任务记录无关', meta: '本地 Git' },
    { view: 'activity', icon: 'list', title: '打开活动', description: '浏览已提交的原始事件与调用详情', meta: `${events.length} 条记录` },
    { view: 'overview', icon: 'info', title: '打开会话概览', description: '工作区、执行状态与当前任务', meta: state ? EXECUTION_LABELS[state.execution] : '—' },
  ];
  const actualAccess = state?.workspace?.access ?? 'custom';
  const commandMode = savedCommandMode ?? 'ask';
  const activeShell = active?.allowShell;
  const activeCommandMode = active?.commandMode ?? 'ask';
  async function updateAuthorization(access: WorkspaceAccess | 'custom', nextMode: CommandMode, allowShell = active?.allowShell === true, confirmation?: AuthorizationConfirmation) {
    if (!active) return;
    setUpdatingAuthorization(true);
    setError('');
    try {
      await configureAuthorization(agentId, access, { turnId: confirmation?.turnId ?? active.turnId, allowShell, commandMode: nextMode }, confirmation);
      // 配置提交成功才保存项目默认值，失败不能留下已授权的假象。
      setCommandMode(nextMode);
      if (confirmation?.approveCurrentCommand && confirmation.pendingEffectId) {
        setApprovedPending(`${active.turnId}:${confirmation.pendingEffectId}`);
      }
      await queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setUpdatingAuthorization(false);
    }
  }

  const authorizationTarget: AuthorizationConfirmation | undefined = active && state ? {
    turnId: active.turnId,
    expectedRevision: state.executionRevision,
    pendingEffectId: active.pending?.effectId ?? null,
    approveCurrentCommand: active.pending?.kind === 'human' && active.pending.purpose === 'command',
  } : undefined;
  function chooseCommandMode(mode: CommandMode, confirmation?: AuthorizationConfirmation | null) {
    if (mode === 'full' && (!!active !== !!confirmation)) {
      setError('当前任务状态已改变，请重新确认完全访问');
      return;
    }
    if (active) void updateAuthorization(actualAccess, mode, true, confirmation ?? undefined);
    else setCommandMode(mode);
  }

  const firstMessage = state?.messages.find(m => m.role === 'user' && !m.content.startsWith('[System observation]'))?.content.replace(/\s+/g, ' ').trim();
  const title = state?.title ?? firstMessage ?? '新对话';
  async function saveTitle() {
    if (cancelRename.current) {
      cancelRename.current = false;
      setRenaming(false);
      return;
    }
    const next = titleDraft.trim();
    setRenaming(false);
    if (!next || next === title) return;
    setError('');
    try { await rename.mutateAsync(next); }
    catch (cause) { setError((cause as Error).message); }
  }
  function startRename() {
    cancelRename.current = false;
    setTitleDraft(state?.title ?? firstMessage ?? '');
    setRenaming(true);
  }
  /** 任务导航合并服务端索引与已加载事件；未加载的 Turn 仍可直接定位。 */
  const turnEntries = useMemo(() => turnNavEntries(turnIndex.turns, events), [events, turnIndex.turns]);
  async function loadEarlier() {
    const node = scroll.current;
    if (node && !followScroll.current) {
      prependAnchor.current = { height: node.scrollHeight, top: node.scrollTop };
      followScroll.current = false;
    }
    await eventWindow.loadEarlier();
    requestAnimationFrame(() => { prependAnchor.current = null; });
  }
  const historyAttempt = useRef('');
  useEffect(() => {
    const cursor = `${agentId}:${events[0]?.seq}`;
    if (!eventWindow.hasEarlier || eventWindow.loadingEarlier || historyAttempt.current === cursor) return;
    // 按页自动补齐事实；同一游标失败不循环重试，避免后台请求风暴。
    historyAttempt.current = cursor;
    void loadEarlier().catch(cause => setError((cause as Error).message));
  }, [agentId, events, eventWindow.hasEarlier, eventWindow.loadingEarlier]);
  useEffect(() => {
    if (turnIndex.hasOlder && !turnIndex.loadingOlder) {
      void turnIndex.loadOlder().catch(cause => setError((cause as Error).message));
    }
  }, [turnIndex.turns.length, turnIndex.hasOlder]);

  async function jumpToTurn(turn: { id: string; agentSeq: number }) {
    followScroll.current = false;
    const target = document.getElementById(`turn-${turn.id}`);
    if (target) {
      target.scrollIntoView({ block: 'start' });
      return;
    }
    setError('');
    setLocating(turn.id);
    pendingJump.current = turn.id;
    try {
      await eventWindow.loadThrough(turn.agentSeq);
      const cached = useAgentStreamStore.getState().eventsByAgent[agentId] ?? [];
      if (cached.some(event => event.seq === turn.agentSeq)) return;
      pendingJump.current = null;
      setLocating(null);
      setError('未能加载该任务所在的记录。');
    } catch (cause) {
      pendingJump.current = null;
      setLocating(null);
      setError((cause as Error).message);
    }
  }
  async function exportAs(format: 'markdown' | 'json') {
    setError('');
    setExporting(format);
    try { await exportSession(agentId, format); }
    catch (cause) { setError((cause as Error).message); }
    finally { setExporting(null); }
  }
  useEffect(() => {
    document.title = prefs.settings ? '设置 · Archer' : `${title.slice(0, 40)} · Archer`;
    return () => { document.title = 'Archer'; };
  }, [title, prefs.settings]);
  useEffect(() => {
    if (!inspect) setMaximized(false);
  }, [inspect]);
  useEffect(() => {
    if (!maximized) return;
    const exit = (event: KeyboardEvent) => {
      if (!usePreferences.getState().settings && event.key === 'Escape') setMaximized(false);
    };
    window.addEventListener('keydown', exit);
    return () => window.removeEventListener('keydown', exit);
  }, [maximized]);
  useEffect(() => {
    if (followScroll.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [events, queue.length]);
  useLayoutEffect(() => {
    const anchor = prependAnchor.current;
    if (!anchor || !scroll.current) return;
    scroll.current.scrollTop = scroll.current.scrollHeight - anchor.height + anchor.top;
  }, [events]);
  // 目标 Turn 的历史补齐后，等锚点渲染完成再滚动，避免定位到空位置。
  useEffect(() => {
    const turnId = pendingJump.current;
    if (!turnId) return;
    const target = document.getElementById(`turn-${turnId}`);
    if (!target) return;
    pendingJump.current = null;
    setLocating(null);
    target.scrollIntoView({ block: 'start' });
  }, [events]);
  useEffect(() => {
    const content = scroll.current?.firstElementChild;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (followScroll.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
      else if (scroll.current) setAwayFromLatest(scroll.current.scrollHeight - scroll.current.scrollTop - scroll.current.clientHeight >= 100);
    });
    observer.observe(content);
    if (scroll.current) observer.observe(scroll.current);
    return () => observer.disconnect();
  }, [stateQuery.isLoading]);
  async function submit(message: PromptInputMessage) {
    if ((!submission && (!message.text.trim() && !message.files.length)) || busy || !state) return;
    if (!submission && state.execution !== 'ready') return;
    if (!submission && (modelSettings.data?.models.length ?? 0) === 0) {
      setError('尚未配置模型服务，请先在「设置 → 模型设置」完成配置。');
      return;
    }
    setError('');
    setPreparing(true);
    const request = submission ?? {
      mode,
      input: composerInput(message.text, message.files),
      allowShell: mode === 'send',
      commandMode,
      ...taskOptions(prefs, modelSettings.data),
      requestId: crypto.randomUUID()
    };
    try {
      await submitMessage(request, {
        retry: Boolean(submission),
        paused,
        prepareAuthorization: () => configureAuthorization(agentId, actualAccess),
        resumeQueue: () => resume.mutateAsync(),
        remember: () => setSubmission(request),
        send: value => send.mutateAsync(value),
        steer: value => steer.mutateAsync(value),
        followUp: value => followUp.mutateAsync(value),
      });
      clearSessionDraft(agentId);
      await queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
      setSubmission(null);
      followScroll.current = true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) setSubmission(null);
      setError((cause as Error).message);
      // Prompt Input 收到拒绝后保留附件；重试复用同一请求。
      throw cause;
    } finally {
      setPreparing(false);
    }
  }
  if (stateQuery.isLoading) return <div className="page-message">正在打开对话…</div>;
  if (!state || stateQuery.isError) return <div className="page-message">
  <h2>无法打开对话</h2>
  <p>{stateQuery.error?.message ?? '会话不存在或已被删除。'}</p>
  <Button variant="secondary" onClick={() => void stateQuery.refetch()}>重新加载</Button>
  <Button variant="default" onClick={onNew}>新建对话</Button>
</div>;
  return <div className={`chat-page ${inspect ? 'has-inspector' : ''}`}>
  {removal.dialog}
  <ResizablePanelGroup orientation="horizontal" className="chat-panels"
    onLayoutChanged={(_layout, meta) => {
      // 仅提交用户结束后的宽度；初次布局和窗口约束不覆盖用户偏好。
      if (meta.isUserInteraction && inspect && pendingInspectorWidth.current !== inspectorWidth) {
        setInspectorWidth(pendingInspectorWidth.current);
      }
    }}
  >
  <ResizablePanel id="conversation" className="chat-main-panel" minSize={360}>
  <header className="workspace-top">
    <div className="chat-heading">
      {sidebarState === 'collapsed' && <SidebarTrigger className="workspace-sidebar-trigger" aria-label="展开侧栏" />}
      {renaming ? <Input className="chat-heading-title-input" autoFocus aria-label="会话标题" value={titleDraft} maxLength={200} disabled={rename.isPending}
        onChange={event => setTitleDraft(event.target.value)}
        onBlur={() => void saveTitle()}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
          else if (event.key === 'Escape') { event.preventDefault(); cancelRename.current = true; event.currentTarget.blur(); }
        }} /> : <Button variant="ghost" className="chat-heading-title" title="重命名会话" onClick={startRename}>{title}</Button>}
      <span className="chat-workspace-name" title={workspace}>
        <Icon name="folder" size="sm" />
        {workspace.split('/').filter(Boolean).at(-1) || workspace}
      </span>
    </div>
    <div className="header-actions">
      <span className={`activity ${active ? 'is-running' : ''}`}>{state.execution !== 'ready' ? EXECUTION_LABELS[state.execution] : active ? TURN_STATUS_LABELS[active.status] : '就绪'}{active && queue.length > 0 && ` · ${queue.length} 项排队`}</span>
      <DropdownMenu>
      <DropdownMenuTrigger render={<Button  variant="ghost" size="icon" aria-label="任务导航" title="任务导航"><Icon name="list" /></Button>} />
      <DropdownMenuContent align="end" className="chat-action-menu turn-menu">
        {turnEntries.length === 0 ? <p className="turn-menu-empty">还没有任务。</p> : turnEntries.map(turn => <DropdownMenuItem key={turn.id} disabled={locating !== null} onClick={() => void jumpToTurn(turn)}>
          <span>任务 {turn.id.split(':t').at(-1)}</span>
          <small>{locating === turn.id ? '正在定位…' : `${TURN_STATUS_LABELS[turn.status]} · ${new Date(turn.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}</small>
        </DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
      {/* 右栏展开后由其自身提供收起操作，避免两处开关同时出现。 */}
      {!inspect && <Tooltip label="打开工作台">
        <Button variant="ghost" size="icon" onClick={() => setInspect(true)} aria-expanded={false} aria-label="打开工作台"><Icon name="panel" /></Button>
      </Tooltip>}
      <DropdownMenu>
      <DropdownMenuTrigger render={<Button  variant="ghost" size="icon" aria-label="会话操作" title="会话操作"><Icon name="more" size="md" /></Button>} />
      <DropdownMenuContent align="end" className="chat-action-menu">
        <DropdownMenuItem onClick={startRename}><Icon name="pencil" size="md" />重命名会话</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void exportAs('markdown')} disabled={exporting !== null}><Icon name="file" size="md" />{exporting === 'markdown' ? '正在导出…' : '导出 Markdown'}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void exportAs('json')} disabled={exporting !== null}><Icon name="copy" size="md" />{exporting === 'json' ? '正在导出…' : '导出原始事件'}</DropdownMenuItem>
        <DropdownMenuItem onClick={removal.request} disabled={Boolean(active) || queue.length > 0 || removal.pending} title={active || queue.length > 0 ? '请先停止任务并清空队列' : undefined}><Icon name="trash" size="md" />删除会话</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    </div>
  </header>
  <div className="chat-body">
    <div className="conversation-column">
      <Tabs
        label="会话工作区"
        value={centerView}
        onChange={setCenterView}
        tabIdPrefix="center-tab"
        panelIdPrefix="center-panel"
        items={[
          { value: 'conversation', label: '会话' },
          { value: 'activity', label: '活动' },
          { value: 'context', label: '上下文' },
        ]}
      />
      {/* 三页保持挂载，切换不丢失对话滚动位置、待提交输入或上下文选择。 */}
      <div className="conversation-view" id="center-panel-conversation" role="tabpanel"
        aria-labelledby="center-tab-conversation" hidden={centerView !== 'conversation'}>
      {turnEntries.length > 1 && <nav className="conversation-turn-rail" aria-label="对话快速定位">
        <ScrollArea className="conversation-turn-scroll"><div className="conversation-turn-marks">
        {[...turnEntries].reverse().map((turn, index) => <Tooltip key={turn.id} label={`任务 ${turn.id.split(':t').at(-1)} · ${TURN_STATUS_LABELS[turn.status]}`}><Button variant="ghost" size="icon-xs"
          aria-label={`跳到第 ${index + 1} 轮对话`} title={`任务 ${turn.id.split(':t').at(-1)} · ${TURN_STATUS_LABELS[turn.status]} · ${new Date(turn.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
          disabled={locating !== null} onClick={() => void jumpToTurn(turn)}><span /></Button></Tooltip>)}
        </div></ScrollArea>
      </nav>}
      <div className="chat-scroll" ref={scroll} tabIndex={0} aria-label="对话记录" onWheel={event => {
          if (event.deltaY < 0) followScroll.current = false;
        }} onTouchMove={() => { followScroll.current = false; }} onPointerDown={event => {
          if (event.target === event.currentTarget) followScroll.current = false;
        }} onKeyDown={event => {
          if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) followScroll.current = false;
        }} onScroll={() => {
          const el = scroll.current;
          if (el) {
            const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
            if (nearBottom) followScroll.current = true;
            setAwayFromLatest(!nearBottom);
          }
        }}>
        <div className="conversation-width">
          {state.fault && <div className="error-banner">会话已隔离：{state.fault.message}</div>}

          {streamError && <div role="alert" className="error-banner">事件同步失败：{streamError}<Button variant="link" size="xs" onClick={() => setReconnectVersion(value => value + 1)}>重新连接</Button></div>}
          {!streamError && state.seq > (events.at(-1)?.seq ?? 0) && <div className="sync-hint" role="status">正在同步对话记录…</div>}
          {/* 空窗口尚未同步时只展示加载状态，不能提前宣称工作区已就绪。 */}
          {(events.length > 0 || state.seq === 0) && <EventTimeline
            compact
            onInspectActivity={() => setCenterView('activity')}
            onInspectInvocation={key => { setSelectedInvocation(key); setCenterView('activity'); }}
            // 每次点击都生成新的定位对象，读同一文件也能重新聚焦右侧阅读区。
            onInspectChanges={(turnId, path) => {
              setChangesTurn({ agentId, turnId, path });
              openWorkbench('review');
            }}
            cancellingTurnId={cancelling ? active?.turnId : undefined}
            executionPaused={state.execution !== 'ready'}
            events={events}
            active={Boolean(active)}
            progress={progress}
            pendingInteraction={active?.pending && approvedPending !== `${active.turnId}:${active.pending.effectId}` ? {
              turnId: active.turnId, effectId: active.pending.effectId,
              content: <PendingInteraction key={`${active.turnId}:${active.pending.effectId}`} agentId={agentId} turn={active} events={events} workspacePath={state.workspace?.cwd} />,
            } : undefined}
          />}
        </div>
      </div>
      {awayFromLatest && <Button variant="secondary" size="sm" className="jump-latest" onClick={() => {
        followScroll.current = true;
        setAwayFromLatest(false);
        scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' });
      }}><Icon name="arrow-down" size="sm" />回到最新</Button>}
      <div className="composer-dock"><div className="conversation-width">
          <CurrentPlan events={events} turnId={active?.turnId} />
          {state.execution === 'blocked' && <div className="warning-banner" role="status">原执行能力暂不可用，或需要处理未确认的结果。请由宿主核查 Provider 配置与来源身份。</div>}
          {state.fault && <div className="error-banner" role="alert">暂时无法发送：{state.fault.message}</div>}
          <QueuePanel paused={paused} queued={queue} steering={state.pendingSteering} disabled={queueDisabled} resumePending={resume.isPending} clearPending={clear.isPending} onResume={() => resume.mutate()} onClear={() => clear.mutate()} />
          {(resume.error || clear.error || abort.error) && <div className="error-banner" role="alert">{(resume.error || clear.error || abort.error)?.message}</div>}
          {submission && !busy && !error && <div className="warning-banner" role="status">上次提交尚未确认。点击发送按钮将使用原请求重试。</div>}
          {error && <div className="error-banner" role="alert">
            {error}
            {submission && <span> · 发送结果尚未确认，可用原请求重试。</span>}
          </div>}
          <div className="composer-context">
            {active?.pending && <div className="pending-secondary-actions">
              <Button variant="link" size="xs" aria-expanded={showComposer} aria-controls="next-task-composer" onClick={() => setExpandedPending(showComposer ? null : `${agentId}:${active.pending!.effectId}`)}><Icon name={showComposer ? 'chevron-down' : 'plus'} size="xs" />{showComposer ? '收起任务输入' : '添加下一项任务'}</Button>
              {!showComposer && <Button variant="link" size="xs" disabled={cancelling} onClick={() => abort.mutate(active.turnId)}>{cancelling ? '正在停止…' : '停止任务'}</Button>}
            </div>}
          </div>

          {active && !showComposer && <ComposerControls workspace={workspace ?? undefined} disabled={busy || updatingAuthorization} commandMode={activeShell ? activeCommandMode : 'disabled'} authorizationTarget={authorizationTarget} onCommandModeChange={chooseCommandMode} />}
          {showComposer && <PromptInput
            key={agentId}
            id="next-task-composer"
            className="composer"
            accept="image/png,image/jpeg,image/webp,image/gif,text/plain,.txt,.md,.markdown,.json,.csv,.tsv,.log,.yaml,.yml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.sh,.sql,.toml,.ini,.java,.go,.rs,.c,.h,.cpp"
            multiple
            maxFiles={4}
            maxFileSize={5 * 1024 * 1024}
            onSubmit={submit}
            onError={({ code }) => setError(code === 'max_files' ? '每条消息最多添加 4 个附件' : code === 'max_file_size' ? '图片不超过 5 MiB，文本文件不超过 256 KiB' : '支持图片或不超过 256 KiB 的 UTF-8 文本文件')}
          >
            <ComposerAttachmentHeader />
            <PromptInputBody>
              <DraftComposerTextarea draftKey={`agent:${agentId}`} disabled={busy || Boolean(submission)} />
            </PromptInputBody>
            <PromptInputFooter className="composer-footer">
              <PromptInputTools className="composer-tools">
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger className="composer-attach" disabled={busy || Boolean(submission)} />
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments label="添加图片或文本文件" disabled={busy || Boolean(submission)} />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
                {active && !submission && <Select items={[{ value: 'followUp', label: '排队下一任务' }, { value: 'steer', label: '补充当前任务' }]} value={mode} disabled={busy} onValueChange={value => setPreferred(String(value) as Mode)}>
                  <SelectTrigger size="sm" className="composer-picker task-mode-picker" aria-label="发送方式">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent side="top" align="start" alignItemWithTrigger={false} className="composer-select-content">
                    <SelectItem value="followUp">排队下一任务</SelectItem>
                    <SelectItem value="steer" disabled={cancelling}>补充当前任务</SelectItem>
                  </SelectContent>
                </Select>}
                <ComposerControls workspace={workspace ?? undefined} disabled={busy || Boolean(submission)} shellDisabled={updatingAuthorization || !active && mode !== 'send'} commandMode={active ? activeShell ? activeCommandMode : 'disabled' : mode === 'send' ? submission?.commandMode ?? commandMode : 'disabled'} authorizationTarget={authorizationTarget} onCommandModeChange={chooseCommandMode} />
              </PromptInputTools>
              <DraftComposerSendButton draftKey={`agent:${agentId}`} onStop={active ? () => abort.mutate(active.turnId) : undefined} stopping={cancelling} busy={busy} locked={Boolean(submission)} idleLabel={sendLabel} disabled={!submission && (state.execution !== 'ready' || (modelSettings.data?.models.length ?? 0) === 0)} />
            </PromptInputFooter>
          </PromptInput>}
        </div></div>
      </div>
      <section className="center-inspection-view" id="center-panel-activity" role="tabpanel"
        aria-labelledby="center-tab-activity" hidden={centerView !== 'activity'}>
        <EventPanel visible={centerView === 'activity'} events={events} hasEarlier={eventWindow.hasEarlier} selectedId={selectedInvocation} onSelect={setSelectedInvocation} />
      </section>
      <section className="center-inspection-view" id="center-panel-context" role="tabpanel"
        aria-labelledby="center-tab-context" hidden={centerView !== 'context'}>
        <ContextPanel visible={centerView === 'context'} events={events} hasEarlier={eventWindow.hasEarlier} />
      </section>
    </div>
    </div>
    </ResizablePanel>
    {inspect && <>
    <ResizableHandle withHandle className="inspector-handle" />
    <ResizablePanel
      id="workbench"
      className="chat-inspector-panel"
      defaultSize={inspectorWidth}
      minSize={320}
      maxSize="70%"
      onResize={size => { pendingInspectorWidth.current = Math.round(size.inPixels); }}
    >
    <Workbench
      view={inspectorView}
      maximized={maximized}
      focused={focused}
      onView={view => {
        setInspectorView(view);
        // 回到首页不保留整窗阅读，避免首页被撑满全屏。
        if (view === 'workbench') setMaximized(false);
      }}
      onFocusMode={() => setFocused(!focused)}
      onMaximize={() => setMaximized(!maximized)}
      onClose={() => {
        setMaximized(false);
        setInspect(false);
      }}
    >
      {inspectorView === 'workbench' && <WorkbenchHome entries={workbenchEntries} onOpen={openWorkbench} />}
      {inspectorView === 'review' && <ChangesPanel entries={changeEntries} hasEarlier={eventWindow.hasEarlier} initialFile={changesFocus} />}
      {inspectorView === 'workspace' && <WorkspaceGitPanel agentId={agentId} workspace={workspace} />}
      {inspectorView === 'activity' && <div className="workbench-activity"><EventPanel events={events} hasEarlier={eventWindow.hasEarlier} selectedId={selectedInvocation} onSelect={setSelectedInvocation} /></div>}
      {inspectorView === 'overview' && <SessionOverview
        workspace={workspace}
        execution={state ? EXECUTION_LABELS[state.execution] : '—'}
        records={state?.seq ?? 0}
        task={active ? `任务 ${active.turnId.split(':t').at(-1)} · ${TURN_STATUS_LABELS[active.status]}` : '无运行中任务'}
        queued={queue.length}
        changedFiles={changedFiles}
      />}
    </Workbench>
    </ResizablePanel>
    </>}
  </ResizablePanelGroup>
</div>;
}
