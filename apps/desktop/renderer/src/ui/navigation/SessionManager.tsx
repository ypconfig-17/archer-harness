import { Input } from '@archer/ui';
/**
 * 会话管理：列出服务端全部会话，支持搜索、打开与删除。
 * 删除提交 agent.removed 事实并释放访问范围；事件日志保留，运行中的会话由 Runtime 拒绝删除。
 */

import { useState } from 'react';
import type { AgentSnapshot, AgentSummary, Snapshot } from '@archer/contracts';
import { useAgentStates, useAgents } from '../../hooks/use-runtime';
import { useSessionRemoval } from './SessionRemoval';
import { RecoveryRecordsPanel } from './RecoveryRecordsPanel';
import { usePreferences } from '../../store/preferences';
import { useUiStore } from '../../store/ui';
import { formatTime } from '../../lib/format';
import { Button, Icon } from '@archer/ui';

interface SessionInfo {
  agent: Snapshot<AgentSummary>;
  title: string;
  workspace: string;
  running: boolean;
  paused: boolean;
  queued: number;
  ready: boolean;
  failed: boolean;
}

function sessionTitle(agent: Snapshot<AgentSummary>, state: Snapshot<AgentSnapshot> | null | undefined): string {
  if (state?.title) return state.title;
  if (agent.title) return agent.title;
  const message = state?.messages.find(item => item.role === 'user' && !item.content.startsWith('[System observation]'));
  return message ? message.content.replace(/\s+/g, ' ').slice(0, 70) : '新会话';
}

function folderName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).at(-1) || root;
}

export function SessionManager({ onLeave }: { onLeave(action: () => void): void }) {
  const agents = useAgents();
  const snapshots = useAgentStates((agents.data ?? []).map(agent => agent.id));
  const activeAgentId = useUiStore(state => (state.view.type === 'agent' ? state.view.agentId : null));
  const openSettings = usePreferences(state => state.openSettings);
  const [search, setSearch] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);
  const keyword = search.trim().toLowerCase();
  const sessions: SessionInfo[] = (agents.data ?? []).map((agent, index) => {
    const state = snapshots[index]?.data;
    return {
      agent,
      title: sessionTitle(agent, state),
      workspace: state?.workspace?.cwd ?? '',
      running: Boolean(agent.activeTurnId),
      paused: agent.queuePaused,
      queued: state?.queuedInputs.length ?? 0,
      ready: snapshots[index]?.isSuccess ?? false,
      failed: snapshots[index]?.isError ?? false,
    };
  }).filter(session => `${session.title} ${session.workspace} ${session.agent.id}`.toLowerCase().includes(keyword));

  function open(agentId: string) {
    onLeave(() => {
      useUiStore.getState().selectAgent(agentId);
      openSettings(false);
    });
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setShowRecovery(true)}>管理异常历史记录</Button>
      {showRecovery && <RecoveryRecordsPanel onClose={() => setShowRecovery(false)} />}
      <section className="settings-group">
        <div className="management-toolbar">
          <label className="management-search">
            <Icon name="search" size="sm" />
            <Input aria-label="搜索会话" placeholder="搜索会话标题或工作区" value={search} onChange={event => setSearch(event.target.value)} />
          </label>
          <span className="management-count">{agents.data ? (keyword ? `${sessions.length} / ${agents.data.length} 个会话` : `共 ${agents.data.length} 个会话`) : agents.isError ? '读取失败' : '正在读取…'}</span>
        </div>
        {snapshots.some(snapshot => snapshot.isError) && <div className="error-banner" role="alert">
          部分会话状态读取失败，状态与排队信息可能不完整。
          <Button variant="link" size="xs" onClick={() => void Promise.all(snapshots.filter(snapshot => snapshot.isError).map(snapshot => snapshot.refetch()))}>重试</Button>
        </div>}
        {agents.isError ? (
          <div className="error-banner" role="alert">
            {agents.error.message}
            <Button variant="link" size="xs" onClick={() => void agents.refetch()}>重新加载</Button>
          </div>
        ) : agents.isLoading ? (
          <p className="settings-note">正在读取会话…</p>
        ) : sessions.length === 0 ? (
          <p className="management-empty">{keyword ? '没有匹配的会话。' : '还没有会话；开始对话后会出现在这里。'}</p>
        ) : (
          <div className="management-list" role="list">
            {sessions.map(session => (
              <SessionRow key={session.agent.id} session={session} active={session.agent.id === activeAgentId} onOpen={open} />
            ))}
          </div>
        )}
      </section>
      <p className="settings-note">删除会结束该会话的使用；已提交的事件日志仍保留在服务端。执行中的任务和排队输入由服务端拒绝删除，等待人工确认的会话可以直接删除。</p>
    </>
  );
}

function SessionRow({ session, active, onOpen }: { session: SessionInfo; active: boolean; onOpen(agentId: string): void }) {
  const removal = useSessionRemoval(session.agent.id, session.title);
  const status = session.failed ? '状态读取失败' : !session.ready ? '读取中…' : session.running ? '运行中' : session.queued > 0 ? `排队 ${session.queued}` : session.paused ? '已暂停' : '空闲';

  return (
    <div className={`management-row ${active ? 'is-current' : ''}`} role="listitem">
      <div className="management-primary">
        <strong className="management-title" title={session.title}>{session.title}</strong>
        <span className="management-meta">
          {session.workspace && (
            <span className="management-workspace" title={session.workspace}>
              <Icon name="folder" size="xs" />
              {folderName(session.workspace)}
            </span>
          )}
          <span>{formatTime(session.agent.createdAt)}</span>
          {active && <span className="management-badge">当前会话</span>}
        </span>
      </div>
      <div className="management-actions">
        <span className={`management-state ${session.running ? 'running' : session.paused ? 'paused' : ''}`}>
          <span className={`chat-dot ${session.running ? 'running' : session.paused ? 'paused' : ''}`} />
          {status}
        </span>
        <Button variant="secondary" size="sm" onClick={() => onOpen(session.agent.id)}>打开</Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={removal.pending}
          title="删除会话"
          onClick={removal.request}
        >
          删除
        </Button>
      </div>
      {removal.dialog}
    </div>
  );
}
