import { Input } from '@archer/ui';
/**
 * 项目管理：工作区来自本机导航记录与已有会话的工作目录。
 * 这里的移除只调整导航偏好，不删除磁盘目录或会话事实。
 */

import { useState } from 'react';
import { useAgentStates, useAgents } from '../../hooks/use-runtime';
import { usePreferences } from '../../store/preferences';
import { useUiStore } from '../../store/ui';
import { useWorkspaceNavigation } from '../../store/workspaces';
import { formatRelative, formatTime } from '../../lib/format';
import { Button, Icon } from '@archer/ui';

interface ProjectInfo {
  root: string;
  name: string;
  sessions: number;
  running: number;
  lastCreatedAt?: number;
  hidden: boolean;
}

function folderName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).at(-1) || root;
}

export function ProjectManager({ onAddWorkspace, onLeave }: { onAddWorkspace(): void; onLeave(action: () => void): void }) {
  const agents = useAgents();
  const snapshots = useAgentStates((agents.data ?? []).map(agent => agent.id));
  const navigation = useWorkspaceNavigation();
  const openSettings = usePreferences(state => state.openSettings);
  const [search, setSearch] = useState('');

  const discovered = new Map<string, { sessions: number; running: number; lastCreatedAt: number }>();
  agents.data?.forEach((agent, index) => {
    const root = snapshots[index]?.data?.workspace?.cwd;
    if (!root) return;
    const entry = discovered.get(root) ?? { sessions: 0, running: 0, lastCreatedAt: 0 };
    entry.sessions += 1;
    if (agent.activeTurnId) entry.running += 1;
    entry.lastCreatedAt = Math.max(entry.lastCreatedAt, agent.createdAt);
    discovered.set(root, entry);
  });

  const known = [...navigation.recent, ...navigation.hidden, ...discovered.keys()];
  const projects: ProjectInfo[] = [...new Set(known)].map(root => {
    const counts = discovered.get(root);
    return {
      root,
      name: folderName(root),
      sessions: counts?.sessions ?? 0,
      running: counts?.running ?? 0,
      lastCreatedAt: counts?.lastCreatedAt,
      hidden: navigation.hidden.includes(root),
    };
  });
  const keyword = search.trim().toLowerCase();
  const failed = agents.isError || snapshots.some(snapshot => snapshot.isError);
  const ready = agents.isSuccess && snapshots.every(snapshot => snapshot.isSuccess);
  const visible = projects.filter(project => !project.hidden && `${project.name} ${project.root}`.toLowerCase().includes(keyword));
  const hidden = projects.filter(project => project.hidden && `${project.name} ${project.root}`.toLowerCase().includes(keyword));

  function start(root: string) {
    onLeave(() => {
      navigation.select(root);
      useUiStore.getState().openNewAgent();
      openSettings(false);
    });
  }

  return (
    <>
      <section className="settings-group">
        <div className="management-toolbar">
          <label className="management-search">
            <Icon name="search" size="sm" />
            <Input aria-label="搜索项目" placeholder="搜索项目名称或路径" value={search} onChange={event => setSearch(event.target.value)} />
          </label>
          <span className="management-count">{projects.length > 0 ? `共 ${projects.length} 个项目` : ''}</span>
          <Button variant="default" size="sm" onClick={onAddWorkspace}>
            <Icon name="folder-plus" size="sm" />
            打开文件夹
          </Button>
        </div>
        {failed && <div className="error-banner" role="alert">
          无法读取完整的会话信息，项目统计暂不可用。
          <Button variant="link" size="xs" onClick={() => {
            void agents.refetch();
            void Promise.all(snapshots.filter(snapshot => snapshot.isError).map(snapshot => snapshot.refetch()));
          }}>重试</Button>
        </div>}
        {visible.length === 0 && hidden.length === 0 ? (
          <p className="management-empty">{keyword ? '没有匹配的项目。' : failed ? '暂时无法确认完整项目列表。' : !ready ? '正在读取项目与关联会话…' : '导航中还没有项目；打开本机文件夹后，它会出现在这里。'}</p>
        ) : (
          <div className="management-list" role="list">
            {visible.map(project => (
              <ProjectRow key={project.root} project={project} active={navigation.selected === project.root} ready={ready} failed={failed} onStart={start} />
            ))}
          </div>
        )}
      </section>
      {hidden.length > 0 && (
        <section className="settings-group">
          <h4>已移出导航</h4>
          <div className="management-list" role="list">
            {hidden.map(project => (
              <ProjectRow key={project.root} project={project} active={false} ready={ready} failed={failed} onStart={start} />
            ))}
          </div>
        </section>
      )}
      <p className="settings-note">项目列表来自本机导航记录与会话的工作目录。移除只影响导航，不删除磁盘文件或会话记录。</p>
    </>
  );
}

function ProjectRow({ project, active, ready, failed, onStart }: { project: ProjectInfo; active: boolean; ready: boolean; failed: boolean; onStart(root: string): void }) {
  const navigation = useWorkspaceNavigation();
  const [confirming, setConfirming] = useState(false);
  const removable = ready && project.sessions === 0;

  return (
    <div className={`management-row ${active ? 'is-current' : ''}`} role="listitem">
      <div className="management-primary">
        <strong className="management-title" title={project.root}>{project.name}</strong>
        <span className="management-meta">
          <span className="management-path" title={project.root}>{project.root}</span>
          <span>{ready ? (project.sessions > 0 ? `${project.sessions} 个会话` : '暂无会话') : failed ? '会话统计不可用' : '读取会话…'}</span>
          {ready && project.running > 0 && <span>{project.running} 个运行中</span>}
          {project.lastCreatedAt !== undefined && <span title={formatTime(project.lastCreatedAt)}>最近活动 {formatRelative(project.lastCreatedAt)}</span>}
          {active && <span className="management-badge">当前</span>}
        </span>
      </div>
      <div className="management-actions">
        <Button variant="secondary" size="sm" onClick={() => onStart(project.root)}>新对话</Button>
        {project.hidden ? (
          <Button variant="secondary" size="sm" onClick={() => navigation.unhide(project.root)}>恢复显示</Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => navigation.hide(project.root)}>从导航移除</Button>
        )}
        {removable && (
          <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>移除记录</Button>
        )}
      </div>
      {confirming && (
        <div className="management-confirm">
          <span>移除「{project.name}」的本机导航记录？不会删除磁盘目录或任何会话。</span>
          <div>
            <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>取消</Button>
            <Button variant="destructive-solid" size="sm" onClick={() => { navigation.forget(project.root); setConfirming(false); }}>确认移除</Button>
          </div>
        </div>
      )}
    </div>
  );
}
