import { CodeSnippet } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example({ state = 'default' }: { state?: string }) {
  return state === 'diff' ? (
    <CodeSnippet
      title="历史片段"
      lineNumbers
      lines={[
        { text: 'return oldValue;', kind: 'removed', number: 1 },
        { text: 'return newValue;', kind: 'added', number: 1 },
      ]}
    />
  ) : (
    <CodeSnippet
      title="example.ts"
      text={'export const ready = true;\n// 固定代码示例'}
      lineNumbers
      wrap={state === 'wrap'}
    />
  );
}
