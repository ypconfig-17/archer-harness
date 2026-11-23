import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../primitives/Collapsible.js';
import { Button } from '../primitives/Surface.js';
import { Icon } from '../primitives/Icon.js';

export type FileTreeNode =
  | {
      type: 'file';
      path: string;
      name: string;
    }
  | {
      type: 'folder';
      path: string;
      name: string;
      children: readonly FileTreeNode[];
    };

/** 改编自官方 File Tree 组合；路径只作为宿主选择标识，不进行磁盘读取。 */
export function FileTree({
  nodes,
  selectedPath,
  onSelect,
}: {
  nodes: readonly FileTreeNode[];
  selectedPath?: string;
  onSelect(path: string): void;
}) {
  return (
    <nav className="ui-file-tree" aria-label="文件导航">
      {nodes.map((node) => (
        <FileNode key={node.path} node={node} selectedPath={selectedPath} onSelect={onSelect} />
      ))}
    </nav>
  );
}

function FileNode({
  node,
  selectedPath,
  onSelect,
}: {
  node: FileTreeNode;
  selectedPath: string | undefined;
  onSelect(path: string): void;
}) {
  if (node.type === 'file') {
    return (
      <Button variant="secondary"
        className="ui-file-tree-file"
        aria-current={selectedPath === node.path ? 'page' : undefined}
        title={node.path}
        onClick={() => onSelect(node.path)}
      >
        <Icon name="file-plain" />
        <span>{node.name}</span>
      </Button>
    );
  }
  return (
    <Collapsible defaultOpen className="ui-file-tree-folder">
      <CollapsibleTrigger className="ui-file-tree-trigger" title={node.path}>
        <Icon name="chevron-right" size="sm" />
        <Icon name="folder-closed" />
        <span>{node.name}</span>
      </CollapsibleTrigger>
      <CollapsibleContent keepMounted>
        <div className="ui-file-tree-children">
          {node.children.map((child) => (
            <FileNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
