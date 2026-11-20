/** 两侧历史原文共用现成差异渲染；组件不读取磁盘，也不修改审阅事实。 */
import { useMemo, useState } from 'react';
import { MultiFileDiff, File } from '@pierre/diffs/react';
import { CodeBlock, CodeBlockHeader, CodeBlockTitle, CodeBlockActions, CodeBlockCopyButton } from './CodeBlock.js';
import { DIFF_VIEW_CSS } from './diff-theme.js';
import { SegmentedControl } from '../primitives/SegmentedControl.js';

export function HistoricalDiff({ before, after, path = 'file.txt' }: {
  before?: string;
  after: string;
  path?: string;
}) {
  const [overflow, setOverflow] = useState<'scroll' | 'wrap'>('scroll');
  const [layout, setLayout] = useState<'unified' | 'split'>('unified');
  // 文件对象保持稳定，避免无关重绘触发重新解析；路径用于语法识别。
  const oldFile = useMemo(() => ({ name: path, contents: before ?? '' }), [path, before]);
  const newFile = useMemo(() => ({ name: path, contents: after }), [path, after]);
  const options = useMemo(() => ({
    diffStyle: layout,
    overflow,
    // 传统 Git 标记同时提供文字与颜色线索，不能只用侧边色条表示增删。
    diffIndicators: 'classic' as const,
    disableFileHeader: true,
    // Shadow DOM 内显式继承桌面主题和代码刻度，不引入第二套阅读尺寸。
    unsafeCSS: DIFF_VIEW_CSS,
  }), [layout, overflow]);
  // 单侧为空时没有左右对照价值，不显示看似可用却无视觉变化的布局开关。
  const comparable = before !== undefined && before.length > 0 && after.length > 0 && before !== after;
  return (
    <div className="ui-diff">
      <CodeBlock>
        <CodeBlockHeader>
          <CodeBlockTitle>{path}</CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton value={after} />
          </CodeBlockActions>
        </CodeBlockHeader>
        <>
          <SegmentedControl
            className="ui-diff-layout"
            label="长行显示"
            value={overflow}
            options={[
              { value: 'scroll', label: '横向滚动' },
              { value: 'wrap', label: '自动换行' },
            ]}
            onChange={setOverflow}
          />
          {comparable && (
            <SegmentedControl
              className="ui-diff-layout"
              label="差异布局"
              value={layout}
              options={[
                { value: 'unified', label: '统一' },
                { value: 'split', label: '并排' },
              ]}
              onChange={setLayout}
            />
          )}
          {before === undefined ? (
            <File file={newFile} options={options} />
          ) : before === after ? (
            <p className="ui-diff-empty">内容没有变化</p>
          ) : (
            <MultiFileDiff key={layout} oldFile={oldFile} newFile={newFile} options={options} />
          )}
        </>
      </CodeBlock>
    </div>
  );
}
