/** 工作区视图只读本地 Git 的 HEAD 与当前文件差异，和任务审阅的历史事实分开。 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { diffLines } from 'diff';
import { Button, HistoricalDiff, Icon, Input, SegmentedControl } from '@archer/ui';
import type { WorkspaceGitFile } from '@archer/contracts';
import { useReviewScroll } from '../../hooks/use-review-scroll';
import { changeTree } from '../../lib/change-tree';
import { useWorkspaceGitChanges } from '../../hooks/use-workspace-git';
import { ChangeFileTree } from './ChangeFileTree';

const STATUS_LABELS: Record<WorkspaceGitFile['status'], string> = {
  modified: '已修改',
  added: '新增',
  deleted: '已删除',
  renamed: '重命名',
  copied: '复制',
  untracked: '未跟踪',
  conflicted: '冲突',
  typechange: '类型变更',
};

const UNAVAILABLE_LABELS = {
  'no-workspace': '会话没有记录工作区目录',
  'not-a-repository': '当前工作区不是 Git 仓库',
  'git-unavailable': '未找到 git 命令',
  'read-failed': '读取 Git 工作区失败',
} as const;

interface ListedFile {
  file: WorkspaceGitFile;
  known: boolean;
  added: number;
  removed: number;
}

export function WorkspaceGitPanel({ agentId, workspace, initialFile }: {
  agentId: string;
  workspace: string;
  initialFile?: { path: string };
}) {
  const [scope, setScope] = useState<'all' | 'staged' | 'unstaged'>('all');
  const query = useWorkspaceGitChanges(agentId, scope);
  const [treeOpen, setTreeOpen] = useState(true);
  const [filter, setFilter] = useState('');
  const [selection, setSelection] = useState<string | null>(null);
  const changes = query.data;
  const files = useMemo<ListedFile[]>(() => {
    if (!changes?.available) return [];
    return changes.files.map(file => {
      // 只有两侧原文都可读时才计算行数；二进制、超限或读取失败不补造统计。
      const known = file.before !== undefined && file.after !== undefined
        && !file.binary && !file.truncated;
      const parts = known ? diffLines(file.before!, file.after!) : [];
      return {
        file,
        known,
        added: parts.reduce((sum, part) => sum + (part.added ? part.count ?? 0 : 0), 0),
        removed: parts.reduce((sum, part) => sum + (part.removed ? part.count ?? 0 : 0), 0),
      };
    });
  }, [changes]);
  // 对话回执可能使用绝对路径，Git 列表使用仓库相对路径；只定位真实存在的条目。
  useEffect(() => {
    if (!initialFile || !changes?.available) return;
    const normalized = initialFile.path.replaceAll('\\', '/');
    const prefix = changes.root.replaceAll('\\', '/') + '/';
    const target = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
    if (changes.files.some(file => file.path === target)) setSelection(target);
  }, [initialFile, changes]);
  const visible = files.filter(item => item.file.path.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  const selected = files.find(item => item.file.path === selection) ?? files[0];
  const detail = useWorkspaceGitChanges(agentId, scope, selected?.file.path);
  const reader = useReviewScroll(
    JSON.stringify([agentId, workspace, scope, selected?.file.path]),
    detail.isSuccess && !detail.isFetching,
  );
  const detailedFile = detail.data?.available
    ? detail.data.files.find(file => file.path === selected?.file.path) : undefined;
  const detailedItem = detailedFile ? {
    file: detailedFile,
    known: detailedFile.before !== undefined && detailedFile.after !== undefined,
    added: diffLines(detailedFile.before ?? '', detailedFile.after ?? '').reduce((sum, part) => sum + (part.added ? part.count ?? 0 : 0), 0),
    removed: diffLines(detailedFile.before ?? '', detailedFile.after ?? '').reduce((sum, part) => sum + (part.removed ? part.count ?? 0 : 0), 0),
  } : undefined;
  const tree = changeTree(visible.map(item => item.file.path));
  const retry = () => { void query.refetch(); void detail.refetch(); };

  if (query.isPending) {
    return <GitEmpty title="正在读取工作区…" detail={workspace} />;
  }
  if (query.isError) {
    return <GitEmpty title="读取工作区失败" detail={query.error instanceof Error ? query.error.message : String(query.error)}
      action={<Button variant="secondary" size="sm" onClick={retry}>重试</Button>} />;
  }
  if (!changes) return null;
  if (!changes.available) {
    return <GitEmpty title={UNAVAILABLE_LABELS[changes.reason]} detail={changes.detail} note={workspace}
      action={<Button variant="secondary" size="sm" onClick={retry}>重新读取</Button>} />;
  }
  return (
    <section className={`changes-workspace ${treeOpen ? '' : 'tree-hidden'}`} aria-label="工作区 Git 变更">
      <header className="changes-toolbar">
        <span className="git-scope" title={changes.root}>
          <Icon name="git-branch" size="sm" />
          <strong>{changes.branch ?? '分离 HEAD'}</strong>
          <span>{changes.files.length} 个文件{changes.omitted ? ` · 另有 ${changes.omitted} 个未列出` : ''}</span>
        </span>
        <Button className="changes-refresh" variant="ghost" size="icon-sm" aria-label="刷新工作区变更"
          title="刷新工作区变更" disabled={query.isFetching} onClick={retry}>
          <Icon name="refresh" size="sm" />
        </Button>
        <Button className="changes-tree-toggle" variant="ghost" size="icon-sm"
          aria-label={treeOpen ? '收起文件树' : '展开文件树'}
          title={treeOpen ? '收起文件树' : '展开文件树'}
          aria-expanded={treeOpen} onClick={() => setTreeOpen(!treeOpen)}>
          <Icon name="folder" size="sm" />
        </Button>
      </header>
      <SegmentedControl label="Git 比较范围" value={scope}
        options={[{ value: 'all', label: '全部未提交' }, { value: 'staged', label: '已暂存' }, { value: 'unstaged', label: '未暂存' }]}
        onChange={setScope} />
      <div className="changes-body">
        <aside className="changes-outline" aria-label="工作区文件导航">
          <label className="changes-search">
            <Icon name="search" size="sm" />
            <Input aria-label="筛选工作区文件" placeholder="筛选文件…" value={filter}
              onChange={event => setFilter(event.target.value)} />
          </label>
          <div className="changes-scope"><span>Git 未提交改动</span><span>{changes.files.length} 个文件</span></div>
          <nav className="changes-files" aria-label="工作区已修改文件">
            <ChangeFileTree nodes={tree} selected={selected?.file.path} onSelect={path => {
              setSelection(path);
            }} />
            {!visible.length && <p className="changes-empty">没有匹配的文件</p>}
          </nav>
        </aside>
        <div ref={reader} className="changes-reader" key={`${selected?.file.path}`}>
          {selected ? detail.isPending || detail.isFetching ? <p className="changes-empty">正在读取文件…</p>
            : detail.isError ? <p className="changes-empty">读取文件失败，请刷新重试</p>
            : detailedItem ? <GitFileReader item={detailedItem} /> : null
            : <p className="changes-empty">工作区没有未提交改动</p>}
        </div>
      </div>
      <footer>本地 Git 工作区（包含其他来源的改动） · {scope === 'staged' ? 'HEAD → 暂存区' : scope === 'unstaged' ? '暂存区 → 工作区' : 'HEAD → 工作区'} · 不代表任务记录</footer>
    </section>
  );
}

function GitFileReader({ item }: {
  item: ListedFile;
}) {
  const { file } = item;
  const flags = [
    STATUS_LABELS[file.status],
    file.staged ? '已暂存' : '',
    file.workingTree && file.status !== 'untracked' ? '未暂存' : '',
  ].filter(Boolean).join(' · ');
  return <>
    <header>
      <strong>{file.path.split(/[\\/]/).at(-1) ?? file.path}</strong>
      <span title={file.path}>{flags}</span>
      {item.known && <span className="changes-count">
        <span className="change-added">+{item.added}</span>
        <span className="change-removed">−{item.removed}</span>
      </span>}
      {!item.known && !file.binary && !file.truncated && <small>行数未知</small>}
    </header>
    {file.previousPath && <p className="changes-segment">原路径 {file.previousPath}</p>}
    <div className="git-file-body">
      {file.binary ? <p className="changes-empty">二进制文件，不展示内容</p>
        : file.truncated ? <p className="changes-empty">文件超过读取上限，未加载内容</p>
        : !item.known ? <>
          <p className="changes-segment">{file.status === 'untracked' && file.after === undefined
            ? '未跟踪的目录，不展开内部文件'
            : `无法读取${file.before === undefined ? '修改前' : '修改后'}内容，不推断差异`}</p>
          {file.after !== undefined && <HistoricalDiff path={file.path} after={file.after} />}
        </> : <HistoricalDiff path={file.path} before={file.before!} after={file.after!} />}
    </div>
  </>;
}

function GitEmpty({ title, detail, note, action }: {
  title: string;
  detail?: string;
  note?: string;
  action?: ReactNode;
}) {
  return (
    <section className="changes-empty-workspace" aria-label="工作区 Git 变更">
      <Icon name="git-branch" size="lg" />
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
      {note && <small>{note}</small>}
      {action}
    </section>
  );
}
