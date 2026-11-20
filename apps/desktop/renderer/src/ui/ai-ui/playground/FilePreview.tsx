import { useState } from 'react';
import { Button, CodeSnippet, FileTree, type FileTreeNode, type CodeLine } from '@archer/ui';

const nodes: readonly FileTreeNode[] = [
  {
    type: 'folder',
    name: 'src',
    path: 'src',
    children: [
      { type: 'file', name: 'conversation.ts', path: 'src/conversation.ts' },
      { type: 'file', name: 'theme.css', path: 'src/theme.css' },
    ],
  },
];
const samples: Record<string, readonly CodeLine[]> = {
  'src/conversation.ts': [
    { text: 'export function title() {', number: 1 },
    { text: "  return '执行完成';", kind: 'removed', number: 2 },
    { text: "  return '结果未知，请核查';", kind: 'added', number: 2 },
    { text: '}', number: 3 },
  ],
  'src/theme.css': [
    { text: '.activity {', number: 1 },
    { text: '  color: var(--secondary);', kind: 'added', number: 2 },
    { text: '}', number: 3 },
  ],
};

/** 固定片段只验收文件树和差异排版，不读取磁盘或模拟真实工具结果。 */
export function FilePreview() {
  const [path, setPath] = useState('src/conversation.ts');
  const [wrap, setWrap] = useState(false);
  return (
    <section aria-label="文件阅读演示">
      <h2>文件与代码阅读</h2>
      <p>固定演示片段 · 展示增删行，不执行差异计算或文件写入。</p>
      <div className="demo-file-workspace">
        <FileTree nodes={nodes} selectedPath={path} onSelect={setPath} />
        <div>
          <Button variant="secondary" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>
            自动换行
          </Button>
          <CodeSnippet title={path} lines={samples[path]!} lineNumbers wrap={wrap} />
        </div>
      </div>
    </section>
  );
}
