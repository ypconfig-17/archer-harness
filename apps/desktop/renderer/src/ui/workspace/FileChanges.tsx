/** 变更入口：顶部保留摘要，展开后按文件阅读并可直接打开差异。 */
import { useState } from 'react';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Icon,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  ScrollArea,
  Tooltip,
  type IconName,
} from '@archer/ui';
import { summarizeChangeFiles, type TaskChangeFile } from '../../lib/task-insights';

const KIND_LABELS = { added: '新增', modified: '修改', unknown: '未知' } as const;

/** 文档类文件与代码文件使用不同图标；只按扩展名提示，不推断文件内容。 */
function fileIcon(name: string): IconName {
  return /\.(md|mdx|rst|txt)$/i.test(name) ? 'file' : 'file-plain';
}

export function FileChanges({ files, note, onSelect, onReview }: {
  files: readonly TaskChangeFile[];
  note: string;
  onSelect?(path: string): void;
  onReview?(): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const remaining = files.slice(3);
  const summary = summarizeChangeFiles(files);
  const breakdown = [
    summary.modified > 0 ? `修改 ${summary.modified}` : '',
    summary.added > 0 ? `新增 ${summary.added}` : '',
    summary.unknown > 0 ? `未知 ${summary.unknown}` : '',
  ].filter(Boolean).join(' · ');
  const label = [`${summary.files} 个文件变更`, breakdown.replaceAll(' · ', '、')].filter(Boolean).join('，');
  // 有跳转目标时行本体是按钮；没有时保持只读，避免出现无动作的按钮。
  const row = (file: TaskChangeFile) => {
    const content = <>
      <ItemMedia variant="icon"><Icon name={fileIcon(file.name)} size="sm" /></ItemMedia>
      <ItemContent>
        <ItemTitle><span className="file-changes-name">{file.name}</span></ItemTitle>
        {file.directory && <ItemDescription>{file.directory}</ItemDescription>}
      </ItemContent>
      <ItemActions>
        <span className={`file-change-status is-${file.kind}`}>{KIND_LABELS[file.kind]}</span>
        {onSelect && <Icon name="chevron-right" size="xs" />}
      </ItemActions>
    </>;
    // 完整路径通过悬浮提示补充；行内只显示文件名与可截断的目录。
    return <Tooltip key={file.path} label={file.path}>
      {onSelect
        ? <Item variant="default" size="xs" className="file-changes-row" render={<button type="button" />}
          onClick={() => onSelect(file.path)}>{content}</Item>
        : <Item variant="default" size="xs" className="file-changes-row">{content}</Item>}
    </Tooltip>;
  };
  return (
    <Collapsible className="file-changes" open={expanded} onOpenChange={setExpanded}>
      <Item size="xs" className="file-changes-header" title={note} aria-label={label}>
        <Icon name="file" size="sm" />
        <ItemContent>
          <div className="file-changes-heading">
            <ItemTitle className="file-changes-title">文件变更</ItemTitle>
            <span className="file-changes-count">{summary.files}</span>
            {breakdown && <span className="file-changes-breakdown">
              {summary.modified > 0 && <span>修改 {summary.modified}</span>}
              {summary.added > 0 && <span className="file-changes-added">新增 {summary.added}</span>}
              {summary.unknown > 0 && <span>未知 {summary.unknown}</span>}
            </span>}
          </div>
        </ItemContent>
        {onReview && <ItemActions>
          <Button variant="ghost" size="sm" onClick={onReview}>
            查看差异<Icon name="chevron-right" size="xs" />
          </Button>
        </ItemActions>}
      </Item>
      {/* 预览与余下列表互不重复；只展示已确认事实，不把展开动作当作磁盘检查。 */}
      <div className="file-changes-list">{files.slice(0, 3).map(row)}</div>
      {remaining.length > 0 && <>
        <CollapsibleContent keepMounted className="file-changes-content">
          <ScrollArea className="file-changes-scroll" aria-label="其余变更文件">
            <div className="file-changes-list">{remaining.map(row)}</div>
          </ScrollArea>
        </CollapsibleContent>
        <Item size="xs" className="file-changes-trigger" render={<CollapsibleTrigger />}>
          <Icon name="chevron-right" size="xs" className="file-changes-chevron" />
          <span>{expanded ? '收起文件列表' : `展开其余 ${remaining.length} 个文件`}</span>
        </Item>
      </>}
    </Collapsible>
  );
}
