/** 已确认路径的目录投影；复用 @archer/ui 的 FileTree，不扫描磁盘。 */
import { FileTree, type FileTreeNode } from '@archer/ui';
import type { ChangeTreeNode } from '../../lib/change-tree';

export function ChangeFileTree({ nodes, selected, onSelect }: {
  nodes: ChangeTreeNode[];
  selected?: string;
  onSelect(path: string): void;
}) {
  const convert = (items: readonly ChangeTreeNode[]): FileTreeNode[] => items.map(node =>
    node.filePath
      ? { type: 'file', path: node.filePath, name: node.name }
      : { type: 'folder', path: node.path, name: node.name, children: convert(node.children) },
  );
  return <FileTree nodes={convert(nodes)} selectedPath={selected} onSelect={onSelect} />;
}
