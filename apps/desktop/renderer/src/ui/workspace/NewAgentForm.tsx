import { taskOptions } from '../../lib/task-options';
import { composerInput } from '../../lib/composer-input';
import { ComposerAttachmentHeader, ComposerSendButton } from './ComposerPrompt';
import { useSubmissions } from '../../store/submissions';
import { useDraft } from '../../store/drafts';
import { useProjectPreferences } from '../../store/project-preferences';
import { ComposerControls, useModelSettings } from './ComposerControls';
import { usePreferences } from '../../store/preferences';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputTextarea,
  PromptInputTools,
  SidebarTrigger,
  useSidebar,
  type PromptInputMessage,
} from '@archer/ui';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { client } from '../../lib/api';
import { DEFAULT_INSTRUCTIONS, newAgentId } from '../../lib/agent';
import { shortcutLabel } from '../../lib/platform';

function folderName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).at(-1) ?? root;
}

function WelcomeHeading() {
  return <div className="home-heading home-welcome">
      <span className="archer-mark" aria-hidden="true" />
      <h1>欢迎使用 Archer</h1>
      <p className="home-subtitle">从一段对话开始。</p>
    </div>;
}

export function NewAgentForm({
  workspace,
  recentWorkspaces,
  onAddWorkspace,
  onSelectWorkspace,
  onCreated
}: {
  workspace: string | null;
  recentWorkspaces: readonly string[];
  onAddWorkspace(): void;
  onSelectWorkspace(root: string): void;
  onCreated(id: string): void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useDraft(`new:${workspace ?? ''}`);
  const prefs = usePreferences();
  const { state: sidebarState } = useSidebar();
  const modelSettings = useModelSettings();
  const commandMode = useProjectPreferences(state => workspace ? state.commandModes[workspace] ?? 'ask' : 'ask');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useSubmissions(state => state.creations[workspace ?? '']);
  const locked = Boolean(attempt);
  async function submit(message: PromptInputMessage) {
    const root = workspace?.trim() ?? '';
    if (busy || (!message.text.trim() && !message.files.length)) return;
    const workspaceAccess = attempt?.workspaceAccess ?? prefs.workspaceAccess;
    setBusy(true);
    setError('');
    const useShell = true;
    // 网络响应不确定时，重试复用同一身份与请求，避免重复创建或发送。
    const request = attempt ?? {
      id: newAgentId(root),
      requestId: crypto.randomUUID(),
      input: composerInput(message.text, message.files),
      workspaceAccess,
      allowShell: useShell,
      commandMode,
      ...taskOptions(prefs, modelSettings.data)
    };
    useSubmissions.getState().setCreation(root, request);
    try {
      const {
        id,
        requestId
      } = request;
      let agent = await client.get(id);
      agent ??= await client.create({
        id,
        instructions: DEFAULT_INSTRUCTIONS,
        workspace: { cwd: root, access: workspaceAccess }
      });
      await agent.send(request.input, {
        allowShell: useShell,
        commandMode: request.commandMode,
        requestId,
        inference: request.inference,
        limits: request.limits
      });
      await Promise.all([queryClient.invalidateQueries({
        queryKey: ['agents']
      }), queryClient.invalidateQueries({
        queryKey: ['providers']
      })]);
      useSubmissions.getState().setCreation(root, null);
      setDraft('');
      onCreated(agent.id);
    } catch (cause) {
      setError(`${(cause as Error).message}${useSubmissions.getState().creations[root] ? '。可重试发送，或打开已创建的会话查看。' : ''}`);
      // 抛出后 Prompt Input 不会清空附件，重试复用同一请求。
      throw cause;
    } finally {
      setBusy(false);
    }
  }
  if (!workspace) return <div className="welcome">
  <div className="welcome-content">
    <WelcomeHeading />
    <p>先选择一个工作区，开始对话。</p>
    <Button variant="secondary" className="welcome-open" onClick={onAddWorkspace}>
      <Icon name="folder" size="md" />
      <span>打开文件夹…</span>
      <kbd>{shortcutLabel('O')}</kbd>
    </Button>
    {recentWorkspaces.length > 0 ? <div className="welcome-recents">
      <div className="welcome-recents-label">最近的工作区</div>
      {recentWorkspaces.map(root => <Button key={root} variant="ghost" className="welcome-recent" onClick={() => onSelectWorkspace(root)}>
        <Icon name="folder" size="sm" />
        <span className="welcome-recent-name">{folderName(root)}</span>
        <span className="welcome-recent-path" title={root}>{root}</span>
      </Button>)}
    </div> : null}
  </div>
</div>;
  return <div className="new-chat-page">
  <header className="workspace-top new-chat-header"><div className="chat-heading">{sidebarState === 'collapsed' && <SidebarTrigger className="workspace-sidebar-trigger" aria-label="展开侧栏" />}<strong><Icon name="compose" size="md" />新对话</strong></div></header>
  <div className="home">
  <div className="home-content">
    <WelcomeHeading />
    <div className="home-form">
      <DropdownMenu>
        <DropdownMenuTrigger className="home-workspace" title={workspace} aria-label={`切换项目：${folderName(workspace)}`} disabled={busy || locked}>
          <Icon name="folder" size="sm" />{folderName(workspace)}<Icon name="chevron-down" size="xs" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {recentWorkspaces.map(root => <DropdownMenuItem key={root} title={root} onClick={() => onSelectWorkspace(root)}>{folderName(root)}</DropdownMenuItem>)}
          <DropdownMenuItem onClick={onAddWorkspace}>打开文件夹…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PromptInput
        key={workspace ?? ''}
        className="composer home-composer"
        accept="image/png,image/jpeg,image/webp,image/gif,text/plain,.txt,.md,.markdown,.json,.csv,.tsv,.log,.yaml,.yml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.sh,.sql,.toml,.ini,.java,.go,.rs,.c,.h,.cpp"
        multiple
        maxFiles={4}
        maxFileSize={5 * 1024 * 1024}
        onSubmit={submit}
        onError={({ code }) => setError(code === 'max_files' ? '每条消息最多添加 4 个附件' : code === 'max_file_size' ? '图片不超过 5 MiB，文本文件不超过 256 KiB' : '支持图片或不超过 256 KiB 的 UTF-8 文本文件')}
      >
        <ComposerAttachmentHeader />
        <PromptInputBody>
          <PromptInputTextarea aria-label="任务描述" value={draft} disabled={busy || locked} onChange={event => setDraft(event.currentTarget.value)} />
        </PromptInputBody>
        <PromptInputFooter className="composer-footer">
          <PromptInputTools className="composer-tools">
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger className="composer-attach" disabled={busy || locked} />
              <PromptInputActionMenuContent>
                <PromptInputActionAddAttachments label="添加图片或文本文件" disabled={busy || locked} />
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
            <ComposerControls workspace={workspace ?? undefined} disabled={busy || locked} commandMode={attempt?.commandMode ?? commandMode} onCommandModeChange={mode => useProjectPreferences.getState().setCommandMode(workspace, mode)} />
          </PromptInputTools>
          <ComposerSendButton busy={busy} locked={locked} draft={draft} idleLabel="开始对话" />
        </PromptInputFooter>
      </PromptInput>
      {error || locked && !busy ? <div role="alert" className="error-banner">
        {error || '上次发送结果尚未确认。重试会复用原请求，或打开会话查看。'}
        {attempt && <Button variant="link" size="xs" onClick={() => onCreated(attempt.id)}>打开会话</Button>}
      </div> : null}
    </div>

  </div>
  </div>
</div>;
}
