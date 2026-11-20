import { Input } from '@archer/ui';
import {
  Button,
  Spinner,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogActions,
  FormField,
  Icon,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Sidebar as SidebarShell,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  Tooltip,
  useSidebar,
} from '@archer/ui';
import { useSessionRemoval } from './SessionRemoval';
import { useRenameAgent } from '../../hooks/use-runtime';
import { RecoveryRecordsPanel } from './RecoveryRecordsPanel';
import { usePreferences } from '../../store/preferences';
import { useEffect, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { AgentSummary, HealthInfo, Snapshot, TurnStatus } from '@archer/contracts';
import { client } from '../../lib/api';
import { sidebarTurnStatus, sidebarStatusLabel } from '../../lib/sidebar-status';
import { shortcutLabel } from '../../lib/platform';
/** 会话行的状态全部来自摘要与已读取快照，不在导航里推断任务结果。 */
interface ChatEntry {
  id: string;
  title: string;
  active: boolean;
  status?: TurnStatus;
  queued: number;
}
interface Props {
  workspaces: string[];
  hiddenWorkspaces: string[];
  onHideWorkspace(root: string): void;
  selectedWorkspace: string | null;
  onWorkspace(root: string): void;
  onAddWorkspace(): void;
  agents: readonly Snapshot<AgentSummary>[];
  activeAgentId: string | null;
  health: HealthInfo | undefined;
  healthFailed: boolean;
  agentsFailed: boolean;
  onSelect(id: string, root?: string): void;
  onHome(): void;
  onNew(): void;
}
export function Sidebar({
  workspaces,
  hiddenWorkspaces,
  onHideWorkspace,
  selectedWorkspace,
  onWorkspace,
  onAddWorkspace,
  agents,
  activeAgentId,
  health,
  healthFailed,
  agentsFailed,
  onSelect,
  onNew,
  onHome
}: Props) {
  const prefs = usePreferences();
  const { state, isMobile, toggleSidebar, setOpen, setOpenMobile } = useSidebar();
  const collapsed = state === 'collapsed' && !isMobile;
  // 移动端抽屉在选择后自行收起，避免遮住刚打开的会话。
  const closeDrawer = () => setOpenMobile(false);
  const [search, setSearch] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);
  const snapshots = useQueries({
    queries: agents.map(agent => ({
      queryKey: ['agent', agent.id],
      queryFn: () => client.agentState(agent.id),
      staleTime: 3000
    }))
  });
  // 最近任务来自服务端事实；不把没有活跃任务推断为已完成。
  const latestTurns = useQueries({
    queries: agents.map(agent => ({
      queryKey: ['sidebar-latest-turn', agent.id, agent.seq],
      queryFn: async () => {
        const session = await client.get(agent.id);
        return session ? (await session.turns.list({ limit: 1 }))[0] ?? null : null;
      },
      staleTime: 3000,
    })),
  });
  const groups = new Map<string, ChatEntry[]>();
  workspaces.forEach(root => groups.set(root, []));
  agents.forEach((agent, index) => {
    const state = snapshots[index]?.data;
    const group = state?.workspace?.cwd ?? '其他会话';
    const message = state?.messages.find(m => m.role === 'user' && !m.content.startsWith('[System observation]'));
    const title = state?.title ?? agent.title ?? (message ? message.content.replace(/\s+/g, ' ').slice(0, 70) : '新会话');
    if (hiddenWorkspaces.includes(group)) return;
    if (!`${title} ${group} ${agent.id}`.toLowerCase().includes(search.toLowerCase())) return;
    const list = groups.get(group) ?? [];
    list.push({
      id: agent.id,
      title,
      active: Boolean(agent.activeTurnId),
      status: sidebarTurnStatus(agent.activeTurnId, state?.activeTurn, latestTurns[index]?.data),
      // 摘要缺少条目时只在快照读取成功后展示队列长度，不用旧值冒充当前状态。
      queued: state?.queuedInputs.length ?? 0
    });
    groups.set(group, list);
  });
  return <SidebarShell id="conversation-sidebar" collapsible="icon" className="app-sidebar" aria-label="会话导航">
  <SidebarHeader className="p-0 gap-0">
  <div className="brand">
    {/* 折叠态首页入口同时恢复导航，方便继续选择项目与会话，不改变执行状态。 */}
    {collapsed ? <Tooltip label="返回首页">
      <Button variant="ghost" size="icon-sm" aria-label="返回首页" onClick={() => {
        setOpen(true);
        onHome();
      }}>
        <Icon name="home" size="md" />
      </Button>
    </Tooltip> : <strong>
      <span className="archer-mark" aria-hidden="true" />
      <span className="brand-wordmark">Archer</span>
    </strong>}
    <Tooltip label={`${collapsed ? '展开侧栏' : '收起侧栏'} (${shortcutLabel('B')})`}>
      <Button variant="ghost" size="icon-sm" className="sidebar-toggle" onClick={toggleSidebar} aria-label={collapsed ? '展开侧栏' : '收起侧栏'} aria-expanded={!collapsed}><Icon name="panel" size="md" /></Button>
    </Tooltip>
  </div>
  </SidebarHeader>
  <SidebarContent className="p-0 gap-0 overflow-hidden">
  <Button variant="secondary" className="new-chat" onClick={() => { closeDrawer(); onNew(); }} aria-label="新对话" title={`新对话 (${shortcutLabel('N')})`}>
    <Icon name="compose" size="md" />
    <span>新对话</span>
    <kbd>{shortcutLabel('N')}</kbd>
  </Button>
  <label className="search">
    <Icon name="search" size="sm" />
    <Input aria-label="搜索会话" placeholder="搜索对话" title={`搜索对话 (${shortcutLabel('K')})`} value={search} onChange={e => setSearch(e.target.value)} />
  </label>
  <SidebarGroup className="conversation-nav">
    <SidebarGroupLabel>项目</SidebarGroupLabel>
    <SidebarGroupAction
      onClick={onAddWorkspace}
      aria-label="打开文件夹"
      title={`打开文件夹 (${shortcutLabel('O')})`}
    >
      <Icon name="folder-plus" size="sm" />
    </SidebarGroupAction>
    <SidebarGroupContent>
      <SidebarMenu aria-label="会话列表">
        {agentsFailed && <li className="nav-empty" role="alert">会话列表加载失败，正在重试。</li>}
        {[...groups].filter(([workspace, chats]) => !search || chats.length > 0 || workspace.toLowerCase().includes(search.toLowerCase())).map(([workspace, chats]) => <WorkspaceGroup key={workspace} workspace={workspace} chats={chats} selected={workspace === selectedWorkspace} activeAgentId={activeAgentId} searching={Boolean(search)} managed={workspaces.includes(workspace)} onWorkspace={root => { closeDrawer(); onWorkspace(root); }} onSelect={(id, root) => { closeDrawer(); onSelect(id, root); }} onHide={onHideWorkspace} />)}
        {search && ![...groups].some(([workspace, chats]) => chats.length > 0 || workspace.toLowerCase().includes(search.toLowerCase())) && <li className="nav-empty">没有找到相关对话</li>}
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
  </SidebarContent>
  <SidebarFooter className="p-0 gap-0">
  <footer className="sidebar-footer">
    <Button variant="ghost" aria-label="设置" title={`设置 (${shortcutLabel(',')})`} className="settings-entry" onClick={() => prefs.openSettings(true)}>
      <Icon name="settings" size="md" />
      <span>设置</span>
      <kbd>{shortcutLabel(',')}</kbd>
    </Button>
    {Boolean(health?.recoveryFailures) && <Button variant="ghost" className="sidebar-recovery-entry"
      onClick={() => setShowRecovery(true)} aria-label={`${health!.recoveryFailures} 个历史会话无法恢复`}
      title="查看无法恢复的历史记录">
      <Icon name="alert" size="sm" /><span>{health!.recoveryFailures}</span>
    </Button>}
    {showRecovery && <RecoveryRecordsPanel onClose={() => setShowRecovery(false)} />}
    <span className={`sidebar-service ${healthFailed ? 'offline' : health?.ok ? 'online' : ''}`} role="status" aria-label={healthFailed ? '服务连接失败' : health?.ok ? 'Archer 服务已连接' : '正在连接 Archer'} title={healthFailed ? '服务连接失败' : health?.ok ? 'Archer 服务已连接' : '正在连接 Archer'}><Icon name="monitor" size="md" /><span className={`service-dot ${healthFailed ? 'offline' : health?.ok ? 'online' : ''}`} /></span>
  </footer>
  </SidebarFooter>
</SidebarShell>;
}

function WorkspaceGroup({ workspace, chats, selected, activeAgentId, searching, managed, onWorkspace, onSelect, onHide }: {
  workspace: string;
  chats: ChatEntry[];
  selected: boolean;
  activeAgentId: string | null;
  searching: boolean;
  managed: boolean;
  onWorkspace(root: string): void;
  onSelect(id: string, root?: string): void;
  onHide(root: string): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(selected);
  const name = workspace.split('/').filter(Boolean).at(-1) || workspace;
  // 项目操作合并为一个浮层菜单；其他会话不是工作区，不提供目录级操作。
  const hasMenu = managed || workspace !== '其他会话';
  // 分组头只汇总已读取的会话状态，不推断目录本身是否忙。
  const running = chats.filter(chat => chat.active).length;
  const selectedChat = chats.find(chat => chat.id === activeAgentId);
  const previewChats = selectedChat && !chats.slice(0, 5).includes(selectedChat) ? [...chats.slice(0, 4), selectedChat] : chats.slice(0, 5);
  const visibleChats = searching || expanded ? chats : previewChats;
  useEffect(() => {
    // 当前项目随选择自动展开，其余分组保留用户上次的展开或收起。
    if (selected) setOpen(true);
  }, [selected]);
  return <SidebarMenuItem className="workspace-group">
    <Collapsible
      open={searching || open}
      onOpenChange={value => {
        // 搜索期间所有分组强制展开，不把这次强制状态写成用户选择。
        if (!searching) setOpen(value);
      }}
      className="group/collapsible"
    >
      <SidebarMenuButton
        render={<CollapsibleTrigger />}
        isActive={selected && !activeAgentId}
        className="workspace-row"
        title={workspace}
        aria-expanded={searching || open}
      >
        <Icon name={searching || open ? 'chevron-down' : 'chevron-right'} size="xs" />
        <Icon name="folder" size="md" />
        <span className="workspace-select">{name}</span>
      </SidebarMenuButton>
      {running > 0 && <SidebarMenuBadge className="workspace-running" title={`${running} 个任务进行中`} aria-label={`${running} 个任务进行中`}>
        <span className="chat-dot running" aria-hidden="true" />{running}
      </SidebarMenuBadge>}
      {hasMenu && <DropdownMenu>
      <DropdownMenuTrigger render={<SidebarMenuAction
          showOnHover
          aria-label={`${name} 的操作`}
          title="工作区操作"
          onClick={event => event.stopPropagation()}
        ><Icon name="more" size="md" /></SidebarMenuAction>} />
      <DropdownMenuContent align="end">
        {workspace !== '其他会话' && <DropdownMenuItem onClick={() => onWorkspace(workspace)}><Icon name="compose" size="sm" />新建对话</DropdownMenuItem>}
        {managed && <DropdownMenuItem title="保留目录和对话，可通过添加工作区重新显示" onClick={() => onHide(workspace)}><Icon name="x" size="sm" />从侧栏隐藏</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>}
      <CollapsibleContent>
        <SidebarMenuSub>
          {visibleChats.map(chat => <SidebarChat key={chat.id} chat={chat} selected={chat.id === activeAgentId} onSelect={() => onSelect(chat.id, workspace)} />)}
        </SidebarMenuSub>
        {chats.length > 5 && !searching && <Button variant="link" className="workspace-show-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起显示' : `展开其余 ${chats.length - previewChats.length} 条对话`}</Button>}
      </CollapsibleContent>
    </Collapsible>
  </SidebarMenuItem>;
}

function SidebarChat({ chat, selected, onSelect }: {
  chat: ChatEntry;
  selected: boolean;
  onSelect(): void;
}) {
  const removal = useSessionRemoval(chat.id, chat.title);
  const rename = useRenameAgent(chat.id);
  const [error, setError] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(chat.title);
  async function saveTitle() {
    setError('');
    try {
      await rename.mutateAsync(titleDraft.trim());
      setRenaming(false);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  return <SidebarMenuSubItem className={chat.queued > 0 ? 'chat-row has-queue' : 'chat-row'}>
    <SidebarMenuSubButton
      render={<button type="button" />}
      isActive={selected}
      onClick={onSelect}
      title={chat.title}
      aria-current={selected ? 'page' : undefined}
    >
      <span className="chat-title">{chat.title}</span>
    </SidebarMenuSubButton>
    {(sidebarStatusLabel(chat.status) || chat.queued > 0) && <SidebarMenuBadge className="chat-indicators">
      {chat.queued > 0 && <span className="chat-queued" title={`${chat.queued} 项排队`} aria-label={`${chat.queued} 项排队`}>{chat.queued}</span>}
      <span className="chat-status-slot">
        {sidebarStatusLabel(chat.status) && <Tooltip label={sidebarStatusLabel(chat.status)!}>
          {chat.status === 'running'
            ? <Spinner size="sm" label={sidebarStatusLabel(chat.status)} />
            : <span className={`chat-status-dot ${chat.status}`} role="img" aria-label={sidebarStatusLabel(chat.status)} />}
        </Tooltip>}
      </span>
    </SidebarMenuBadge>}
    <DropdownMenu>
      <DropdownMenuTrigger render={<SidebarMenuAction showOnHover aria-label={`${chat.title} 的操作`}><Icon name="more" size="sm" /></SidebarMenuAction>} />
      <DropdownMenuContent align="end">
      <DropdownMenuItem disabled={rename.isPending} onClick={() => {
        setTitleDraft(chat.title);
        setError('');
        setRenaming(true);
      }}><Icon name="pencil" size="sm" />重命名会话</DropdownMenuItem>
      <DropdownMenuItem disabled={removal.pending} title="删除会话" onClick={removal.request}><Icon name="trash" size="sm" />删除会话</DropdownMenuItem>
    </DropdownMenuContent>
    </DropdownMenu>
    <Dialog
      open={renaming}
      onOpenChange={value => { if (!rename.isPending) setRenaming(value); }}
      title="重命名会话"
      size="medium"
      closeDisabled={rename.isPending}
    >
      <form onSubmit={event => { event.preventDefault(); void saveTitle(); }}>
        <FormField label="会话标题">
          <Input autoFocus aria-label="会话标题" maxLength={200} value={titleDraft}
            onChange={event => setTitleDraft(event.target.value)} disabled={rename.isPending} />
        </FormField>
        {error && <p role="alert">{error}</p>}
        <DialogActions>
          <Button variant="secondary" disabled={rename.isPending} onClick={() => setRenaming(false)}>取消</Button>
          <Button type="submit" variant="default" disabled={rename.isPending || !titleDraft.trim()}>保存</Button>
        </DialogActions>
      </form>
    </Dialog>
    {removal.dialog}
  </SidebarMenuSubItem>;
}

