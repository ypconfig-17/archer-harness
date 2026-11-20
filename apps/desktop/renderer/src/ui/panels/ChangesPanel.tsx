/** 变更工作区只读取工具确认的历史内容，不读取或推测当前磁盘状态。
 *  布局固定为左目录树、右阅读区；目录树可收起，为窄栏留出完整阅读宽度。 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { diffLines } from 'diff';
import type { EffectEntry } from '../../lib/conversation';
import { taskChanges } from '../../lib/task-insights';
import { Button, HistoricalDiff, Icon, Input, ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@archer/ui';
import { useReviewScroll } from '../../hooks/use-review-scroll';
import { changeTree } from '../../lib/change-tree';
import { ChangeFileTree } from './ChangeFileTree';

export function ChangesPanel({ entries, hasEarlier, initialFile }: {
  entries: readonly EffectEntry[];
  hasEarlier: boolean;
  /** 对话中的文件行传入；对象身份每次点击都会更新，便于重新定位同一文件。 */
  initialFile?: { path: string };
}) {
  const [query, setQuery] = useState('');
  const host = useRef<HTMLElement>(null);
  const [narrow, setNarrow] = useState(true);
  const [treePreference, setTreePreference] = useState<boolean | null>(null);
  // 窄栏默认把宽度交给正文；用户仍可显式展开文件树选文件。
  const treeOpen = treePreference ?? !narrow;
  const [selection, setSelection] = useState<{ turnId: string; path: string } | null>(null);
  const turnId = entries[0]?.turnId;
  // 从对话文件行进入时直接选中该文件；用户随后可在树中切换，定位只响应新的传入对象。
  useEffect(() => {
    if (initialFile && turnId) setSelection({ turnId, path: initialFile.path });
  }, [initialFile, turnId]);
  const files = useMemo(() => {
    const grouped = new Map<string, ReturnType<typeof taskChanges>>();
    for (const change of taskChanges(entries)) {
      const segments = grouped.get(change.path) ?? [];
      segments.push(change);
      grouped.set(change.path, segments);
    }
    return [...grouped].map(([path, segments]) => {
      const parts = segments.flatMap(change => change.before === undefined ? [] : diffLines(change.before ?? '', change.after));
      return {
        path, segments,
        name: path.split(/[\\/]/).at(-1) ?? path,
        directory: path.replace(/[\\/][^\\/]*$/, ''),
        known: segments.every(change => change.before !== undefined),
        added: parts.reduce((sum, part) => sum + (part.added ? part.count ?? 0 : 0), 0),
        removed: parts.reduce((sum, part) => sum + (part.removed ? part.count ?? 0 : 0), 0),
      };
    });
  }, [entries]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 600));
    observer.observe(element);
    return () => observer.disconnect();
  }, [files.length > 0]);
  const visible = files.filter(file => file.path.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  // 历史任务与当前任务的同名文件不能共享选择；筛选也不隐藏仍在阅读的内容。
  const selected = files.find(file => selection?.turnId === turnId && file.path === selection.path) ?? files[0];
  const reader = useReviewScroll(JSON.stringify([turnId, selected?.path]));
  const tree = changeTree(visible.map(file => file.path));
  const pathParts = selected?.path.split(/[\\/]/).filter(Boolean) ?? [];
  const breadcrumb = pathParts.length > 3 ? ['…', ...pathParts.slice(-3)] : pathParts;
  const selectFile = (path: string) => {
    setSelection({ turnId: turnId!, path });
  };
  // 没有变更对象时只呈现一个空态，不保留无效筛选和空阅读双栏。
  if (!files.length) return <section className="changes-empty-workspace" aria-label="本轮历史修改">
    <Icon name="file" size="lg" />
    <h3>暂无文件变更</h3>
    <p>本轮暂无工具确认的文件修改</p>
    {hasEarlier && <small>更早记录尚未全部加载</small>}
  </section>;
  return (
    <section ref={host} className={`changes-workspace ${treeOpen ? '' : 'tree-hidden'}`} aria-label="本轮历史修改">
      <header className="changes-toolbar">
        <nav className="changes-breadcrumb" aria-label="文件路径" title={selected?.path}>
          {selected ? breadcrumb.map((part, index, parts) => (
            <span key={index} aria-current={index === parts.length - 1 ? 'page' : undefined}>
              {index > 0 && <Icon name="chevron-right" size="xs" />}{part}
            </span>
          )) : <span>本轮修改</span>}
        </nav>
        <Button className="changes-tree-toggle" variant="ghost" size="icon-sm"
          aria-label={treeOpen ? '收起文件树' : '展开文件树'}
          title={treeOpen ? '收起文件树' : '展开文件树'}
          aria-expanded={treeOpen} onClick={() => setTreePreference(!treeOpen)}>
          <Icon name="folder" size="sm" />
        </Button>
      </header>
      <ResizablePanelGroup orientation="horizontal" className="changes-body">
        {treeOpen && <>
        <ResizablePanel defaultSize="32%" minSize={140} maxSize="50%" className="changes-tree-panel">
        <aside className="changes-outline" aria-label="修改文件导航">
          <label className="changes-search">
            <Icon name="search" size="sm" />
            <Input aria-label="筛选变更文件" placeholder="筛选文件…" value={query}
              onChange={event => setQuery(event.target.value)} />
          </label>
          <div className="changes-scope"><span>本轮已确认修改</span><span>{files.length} 个文件</span></div>
          <nav className="changes-files" aria-label="已修改文件">
            <ChangeFileTree nodes={tree} selected={selected?.path} onSelect={selectFile} />
            {!visible.length && <p className="changes-empty">{files.length ? '没有匹配的文件' : '暂无修改文件'}</p>}
          </nav>
        </aside>
        </ResizablePanel>
        <ResizableHandle withHandle aria-label="调整文件树宽度" />
        </>}
        <ResizablePanel minSize={180} className="changes-reader-panel">
        <div ref={reader} className="changes-reader" key={`${turnId}:${selected?.path}`}>
          {selected ? <>
            <header>
              <strong>{selected.name}</strong><span>历史修改</span>
              {selected.known ? <span className="changes-count">
                <span className="change-added">+{selected.added}</span>
                <span className="change-removed">−{selected.removed}</span>
              </span> : <small>行数未知</small>}
            </header>
            {/* 不连续记录不能合并成可信净差异，只呈现最新快照；原始记录仍保留在事实中。 */}
            {(() => {
              const latest = selected.segments.at(-1)!;
              return <>
                {latest.before === undefined && <p className="changes-segment">未记录原文，仅展示最新已写入内容</p>}
                {selected.segments.length > 1 && <p className="changes-segment">展示最新记录，早先内容不合并为净差异</p>}
                <HistoricalDiff path={latest.path} before={latest.before === null ? '' : latest.before} after={latest.after} />
              </>;
            })()}
          </> : <p className="changes-empty">本轮暂无工具确认的文件修改</p>}
        </div>
        </ResizablePanel>
      </ResizablePanelGroup>
      <footer>仅展示工具确认的历史修改{hasEarlier ? ' · 更早记录尚未全部加载' : ''}</footer>
    </section>
  );
}
