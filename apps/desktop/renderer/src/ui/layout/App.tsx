import { NavigationPanels } from './NavigationPanels';
import { applyTheme } from '../theme/theme';
import { useSystemDark } from '../theme/system-appearance';
import { useWorkbench } from '../../store/workbench';
import { useQueryClient } from '@tanstack/react-query';
import { AgentDetail } from '../workspace/AgentDetail';
import { NewAgentForm } from '../workspace/NewAgentForm';
import { Sidebar } from '../navigation/Sidebar';
import { useWorkspaceNavigation } from '../../store/workspaces';
import { WorkspaceDialog } from '../navigation/WorkspaceDialog';
import { useAgents, useHealth } from '../../hooks/use-runtime';
import { useUiStore } from '../../store/ui';
import { Settings } from '../settings/Settings';
import { usePreferences } from '../../store/preferences';
import { Button, Icon, SidebarInset, SidebarProvider } from '@archer/ui';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
export default function App() {
  const {
    view,
    selectAgent,
    openNewAgent,
    clear
  } = useUiStore();
  useEffect(() => {
    if (window.archerDesktop?.platform !== 'darwin') return;
    // 标题栏统一接收指针，避免原生拖拽区吞掉双击；交互控件始终排除。
    const isTitlebar = (target: EventTarget | null, y: number) => {
      if (!(target instanceof Element)) return false;
      if (target.closest('button, a, input, select, textarea, [role="button"], [contenteditable], [popover]')) return false;
      if (target.closest('.workspace-top, .settings-workspace-bar')) return true;
      const sidebar = target.closest('.app-sidebar, .welcome');
      if (sidebar && y - sidebar.getBoundingClientRect().top < 46) return true;
      return Boolean(target.closest('.inspector.is-focused .inspector-bar'));
    };
    let pointer: number | undefined;
    let anchor: Element | undefined;
    const onDoubleClick = (event: MouseEvent) => {
      if (isTitlebar(event.target, event.clientY)) window.archerDesktop?.toggleMaximize?.();
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || !isTitlebar(event.target, event.clientY)) return;
      pointer = event.pointerId;
      anchor = event.target as Element;
      anchor.setPointerCapture(pointer);
      window.archerDesktop?.titlebarPointer?.('start', event.screenX, event.screenY);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerId === pointer) window.archerDesktop?.titlebarPointer?.('move', event.screenX, event.screenY);
    };
    const onEnd = () => {
      if (pointer === undefined) return;
      window.archerDesktop?.titlebarPointer?.('end', 0, 0);
      if (anchor?.hasPointerCapture(pointer)) anchor.releasePointerCapture(pointer);
      pointer = undefined;
      anchor = undefined;
    };
    document.addEventListener('dblclick', onDoubleClick);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
    window.addEventListener('blur', onEnd);
    return () => {
      onEnd();
      document.removeEventListener('dblclick', onDoubleClick);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('pointercancel', onEnd);
      window.removeEventListener('blur', onEnd);
    };
  }, []);
  const prefs = usePreferences();
  const systemDark = useSystemDark();
  const openSettings = usePreferences(state => state.openSettings);
  useEffect(() => {
    if (prefs.settings) document.title = '设置 · Archer';
    else if (view.type === 'home') document.title = 'Archer';
  }, [prefs.settings, view.type]);
  useLayoutEffect(() => {
    applyTheme({
      appearance: prefs.appearance,
      baseTheme: prefs.baseTheme,
      colorTheme: prefs.colorTheme,
      customAccent: prefs.customAccent,
    }, systemDark);
    // 原生窗口从同一套语义色取值，不另维护主题颜色副本。
    const style = getComputedStyle(document.documentElement);
    window.archerDesktop?.setTheme?.(prefs.appearance, {
      color: style.getPropertyValue('--bg-sidebar').trim(),
      symbolColor: style.getPropertyValue('--text-primary').trim(),
    });
  }, [prefs.appearance, prefs.baseTheme, prefs.colorTheme, prefs.customAccent, systemDark]);
  useLayoutEffect(() => {
    document.documentElement.dataset.fontSize = prefs.fontSize;
  }, [prefs.fontSize]);
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  const { sidebarCollapsed, toggleSidebar } = useWorkbench();
  const queryClient = useQueryClient();
  const openNewChat = useCallback(() => {
    openNewAgent();
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="任务描述"]')?.focus());
  }, [openNewAgent]);
  useEffect(() => window.archerDesktop?.onMenuAction?.(action => {
    // 设置工作区不响应主会话的导航快捷操作，避免绕过草稿离开检查。
    if (usePreferences.getState().settings && action !== 'settings') return;
    if (action === 'new-chat') openNewChat();
    else if (action === 'open-folder') setAddingWorkspace(true);
    else if (action === 'settings') openSettings(true);
    else if (action === 'toggle-sidebar') toggleSidebar();
    else if (action === 'toggle-inspector') useWorkbench.getState().setInspectorOpen(!useWorkbench.getState().inspectorOpen);
    else if (action === 'search-chats') {
      if (useWorkbench.getState().sidebarCollapsed) toggleSidebar();
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.search input')?.focus());
    }
  }), [openNewChat, openSettings, toggleSidebar]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (usePreferences.getState().settings) return;
      if ((!event.metaKey && !event.ctrlKey) || event.altKey || event.isComposing) return;
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        openNewChat();
      } else if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (useWorkbench.getState().sidebarCollapsed) toggleSidebar();
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.search input')?.focus());
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [toggleSidebar, openNewChat]);
  const workspaceNavigation = useWorkspaceNavigation();
  const workspace = workspaceNavigation.selected;
  const setWorkspace = workspaceNavigation.select;
  const roots = workspaceNavigation.recent;
  const visibleRoots = roots.filter(root => !workspaceNavigation.hidden.includes(root));
  const selectedWorkspace = workspace && visibleRoots.includes(workspace) ? workspace : visibleRoots[0] ?? null;
  const agents = useAgents();
  const health = useHealth();
  return <>
  {/* 保持主工作区挂载，设置只是替换可见区域，返回时不重建输入和检查器。 */}
  <div className="workbench" hidden={prefs.settings} inert={prefs.settings}>
  <Button variant="ghost" size="icon-sm" className="mobile-menu" onClick={toggleSidebar} aria-label="切换会话导航" aria-expanded={!sidebarCollapsed} aria-controls="conversation-sidebar"><Icon name="panel" /></Button>
  <SidebarProvider
    open={!sidebarCollapsed}
    onOpenChange={open => { if (open === sidebarCollapsed) toggleSidebar(); }}
    className="workbench-provider"
  >
  <NavigationPanels navigation={<Sidebar workspaces={visibleRoots} hiddenWorkspaces={workspaceNavigation.hidden} onHideWorkspace={root => {
      workspaceNavigation.hide(root);
      openNewAgent();
    }} selectedWorkspace={selectedWorkspace} onWorkspace={root => {
      setWorkspace(root);
      openNewChat();
    }} onAddWorkspace={() => setAddingWorkspace(true)} agents={agents.data ?? []} agentsFailed={agents.isError} activeAgentId={view.type === 'agent' ? view.agentId : null} health={health.data} healthFailed={health.isError} onSelect={(id, root) => {
      if (root && root !== '其他会话') setWorkspace(root);
      selectAgent(id);
    }} onHome={clear} onNew={openNewChat} />}>
  <SidebarInset className="workspace">
    {health.isError && <div className="connection-banner" role="alert">
      <div><strong>无法连接 Archer 服务</strong><span>会话记录暂时无法更新。请确认后端服务已启动，然后重新连接。</span></div>
      <Button variant="link" size="sm" disabled={health.isFetching} onClick={() => void queryClient.invalidateQueries()}>{health.isFetching ? '正在连接…' : '重新连接'}</Button>
    </div>}
    {view.type === 'agent' ? <AgentDetail key={view.agentId} agentId={view.agentId} onRemoved={clear} onNew={openNewChat} /> : <NewAgentForm key={selectedWorkspace ?? 'empty'} workspace={selectedWorkspace} recentWorkspaces={roots} onSelectWorkspace={root => {
      setWorkspace(root);
      openNewAgent();
    }} onAddWorkspace={() => setAddingWorkspace(true)} onCreated={selectAgent} />}
  </SidebarInset>
  </NavigationPanels>
  </SidebarProvider>
  {addingWorkspace && <WorkspaceDialog onClose={() => setAddingWorkspace(false)} onAdded={root => {
      setWorkspace(root);
      openNewAgent();
      setAddingWorkspace(false);
    }} />}
</div>
  {prefs.settings && <Settings agentId={view.type === 'agent' ? view.agentId : null} onAddWorkspace={() => {
      prefs.openSettings(false);
      setAddingWorkspace(true);
    }} />}
</>;
}
