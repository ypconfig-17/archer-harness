/** 文件树仅由已知路径构造；压缩单子目录，避免 Java 等深目录吃掉文字空间。 */
export interface ChangeTreeNode {
  name: string;
  path: string;
  filePath?: string;
  children: ChangeTreeNode[];
}

export function changeTree(paths: readonly string[]): ChangeTreeNode[] {
  const roots: ChangeTreeNode[] = [];
  for (const path of paths) {
    const segments = path.split(/[\\/]/).filter(Boolean);
    let children = roots;
    let key = '';
    segments.forEach((name, index) => {
      key += `/${name}`;
      let node = children.find(item => item.path === key);
      if (!node) {
        node = { name, path: key, children: [] };
        children.push(node);
      }
      if (index === segments.length - 1) node.filePath = path;
      children = node.children;
    });
  }
  const compact = (nodes: ChangeTreeNode[]): ChangeTreeNode[] => nodes.map(node => {
    let current = node;
    while (!current.filePath && current.children.length === 1 && !current.children[0].filePath) {
      const child = current.children[0];
      current = { ...child, name: `${current.name}/${child.name}` };
    }
    return { ...current, children: compact(current.children) };
  }).sort((a, b) => Number(Boolean(a.filePath)) - Number(Boolean(b.filePath)) || a.name.localeCompare(b.name));
  return compact(roots);
}
