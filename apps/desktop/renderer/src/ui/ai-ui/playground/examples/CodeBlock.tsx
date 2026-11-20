import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFooter,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from '@archer/ui';

/** 官方组合 API 的完整示例，复制值由宿主显式提供。 */
export default function Example({ state = 'default' }: { state?: string }) {
  const text = 'export const ready = true;';
  return (
    <CodeBlock>
      <CodeBlockHeader>
        <CodeBlockTitle>example.ts</CodeBlockTitle>
        <CodeBlockActions><CodeBlockCopyButton value={text} /></CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent wrap={state === 'wrap'} lineNumbers>
        <CodeBlockLine>{text}</CodeBlockLine>
      </CodeBlockContent>
      <CodeBlockFooter>只读代码示例</CodeBlockFooter>
    </CodeBlock>
  );
}
