/** 右栏是工作台：默认列出当前会话真实可读的阅读对象，选中后在原地展开。 */
import type { ReactNode } from 'react';
import { Button, Icon, type IconName } from '@archer/ui';
import type { WorkbenchView } from '../../store/workbench';

const TITLES: Record<WorkbenchView, string> = {
  workbench: '工作台',
  review: '审阅',
  workspace: '工作区',
  activity: '活动',
  overview: '会话概览',
};

const ICONS: Record<WorkbenchView, IconName> = {
  workbench: 'panel',
  review: 'file',
  workspace: 'git-branch',
  activity: 'list',
  overview: 'info',
};

export function Workbench({
  view,
  maximized,
  focused = false,
  onView,
  onFocusMode,
  onMaximize,
  onClose,
  children,
}: {
  view: WorkbenchView;
  maximized: boolean;
  focused?: boolean;
  onView(view: WorkbenchView): void;
  onFocusMode?(): void;
  onMaximize(): void;
  onClose(): void;
  children: ReactNode;
}) {
  const home = view === 'workbench';
  // 面板不能复用外壳的 workbench 类：macOS 外壳背景透明，复用会让最大化面板把下层内容透出来。
  return (
    <aside
      className={`inspector workbench-panel ${view === 'review' || view === 'workspace' ? 'file-inspector' : ''} ${maximized ? 'is-maximized' : ''} ${focused && maximized ? 'is-focused' : ''}`}
      aria-label="工作台"
    >
      <header className="inspector-bar">
        <div className="inspector-heading">
          {!home && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="返回工作台"
              title="返回工作台"
              onClick={event => {
                const host = event.currentTarget.closest('.workbench-panel');
                onView('workbench');
                // 返回后把焦点交还打开该项的卡片，不留在已卸载内容里。
                requestAnimationFrame(() => host?.querySelector<HTMLButtonElement>(`[data-view="${view}"]`)?.focus());
              }}
            >
              <Icon name="arrow-left" size="sm" />
            </Button>
          )}
          <Icon name={ICONS[view]} size="sm" />
          <span>{TITLES[view]}</span>
        </div>
        <div className="inspector-actions">
          {!home && maximized && onFocusMode && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={focused ? '退出专注模式' : '进入专注模式'}
              title={focused ? '恢复会话侧栏' : '隐藏会话侧栏，专注阅读'}
              aria-pressed={focused}
              onClick={onFocusMode}
            >
              <Icon name="panel" size="sm" />
            </Button>
          )}
          {!home && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={maximized ? '还原工作台' : '最大化工作台'}
              title={maximized ? '还原工作台（Esc）' : '最大化整个工作台'}
              aria-pressed={maximized}
              onClick={onMaximize}
            >
              <Icon name={maximized ? 'minimize' : 'maximize'} size="sm" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="收起工作台"
            title="收起工作台"
            onClick={event => {
              const page = event.currentTarget.closest('.chat-page');
              onClose();
              // 收起后把焦点交还重新出现的打开入口，避免焦点留在卸载节点。
              requestAnimationFrame(() => page?.querySelector<HTMLButtonElement>('[aria-label="打开工作台"]')?.focus());
            }}
          >
            <Icon name="panel" size="md" />
          </Button>
        </div>
      </header>
      <div className={`workbench-body is-${view}`}>{children}</div>
    </aside>
  );
}

export interface WorkbenchEntry {
  view: Exclude<WorkbenchView, 'workbench'>;
  icon: IconName;
  title: string;
  description: string;
  meta: string;
}

/** 首页只投影会话里已有的阅读对象；没有接入的能力不占位。 */
export function WorkbenchHome({ entries, onOpen }: {
  entries: readonly WorkbenchEntry[];
  onOpen(view: WorkbenchEntry['view']): void;
}) {
  return (
    <div className="workbench-home">
      <div className="workbench-home-inner">
        <p className="workbench-home-label">当前会话</p>
        <ul className="workbench-cards">
          {entries.map(entry => (
            <li key={entry.view}>
              <Button variant="ghost" className="workbench-card" data-view={entry.view} onClick={() => onOpen(entry.view)}>
                <span className="workbench-card-icon"><Icon name={entry.icon} size="md" /></span>
                <span className="workbench-card-copy">
                  <strong>{entry.title}</strong>
                  <small>{entry.description}</small>
                </span>
                <span className="workbench-card-meta">{entry.meta}</span>
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
