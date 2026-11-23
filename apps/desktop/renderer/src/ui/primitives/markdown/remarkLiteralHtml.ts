/**
 * 原始 HTML 只作为字面文本进入正文：把 mdast 的 html 节点改写成 text 节点，
 * 后续管线因此不会生成 raw 节点，脚本、事件属性和未知标签都不会被执行。
 * 这是 Streamdown 渲染前的格式归一，不解析 HTML，也不决定任何 Markdown 语义。
 */

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
}

export function remarkLiteralHtml(): (tree: MarkdownNode) => void {
  return (tree) => {
    rewrite(tree);
  };
}

function rewrite(node: MarkdownNode): void {
  if (node.children === undefined) return;
  node.children = node.children.map((child) => {
    if (child.type === 'html') return { type: 'text', value: child.value ?? '' };
    rewrite(child);
    return child;
  });
}
