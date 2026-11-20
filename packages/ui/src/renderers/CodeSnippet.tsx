/** 业务只组合官方 Code Block 原语与高亮 hook，不另行实现外壳、复制和行布局。 */
import { CodeBlock, CodeBlockHeader, CodeBlockTitle, CodeBlockActions, CodeBlockCopyButton, CodeBlockContent, CodeBlockLine } from './CodeBlock.js';
import { useHighlightedCode } from './use-highlighted-code.js';

export interface CodeLine {
  text: string;
  kind?: 'added' | 'removed';
  number?: number;
}

export function CodeSnippet({ title, text, lines, lineNumbers = false, wrap = false }: {
  title: string;
  text?: string;
  lines?: readonly CodeLine[];
  lineNumbers?: boolean;
  wrap?: boolean;
}) {
  const content = text ?? lines?.map(line => line.text).join('\n') ?? '';
  const extension = title.split('.').at(-1)?.toLowerCase() ?? '';
  const language = ({ ts: 'typescript', js: 'javascript', md: 'markdown', sh: 'bash' } as Record<string, string>)[extension] ?? extension;
  const highlighted = useHighlightedCode(content, language);
  return <CodeBlock>
    <CodeBlockHeader>
      <CodeBlockTitle title={title}>{title}</CodeBlockTitle>
      <CodeBlockActions><CodeBlockCopyButton value={content} /></CodeBlockActions>
    </CodeBlockHeader>
    <CodeBlockContent lineNumbers={lineNumbers} wrap={wrap} startLine={lines?.[0]?.number ?? 1}>
      {highlighted.map((line, index) => <CodeBlockLine key={index} variant={lines?.[index]?.kind ?? 'default'}>{line}</CodeBlockLine>)}
    </CodeBlockContent>
  </CodeBlock>;
}
