import { StackTrace } from '@archer/ui';

/** 帧数据固定提供，不解析真实堆栈字符串。 */
export default function Example({ state = 'default' }: { state?: string }) {
  return (
    <StackTrace
      message="TypeError: 无法读取 sourceRevision"
      defaultOpen={state !== 'collapsed'}
      frames={[
        {
          id: 'frame-1',
          functionName: 'projectTurn',
          file: 'packages/ui/src/ai/TestResults.tsx',
          line: 42,
          column: 11,
        },
        {
          id: 'frame-2',
          functionName: 'render',
          file: 'apps/desktop/renderer/src/ui/workspace/EventTimeline.tsx',
          line: 318,
          column: 7,
        },
        {
          id: 'frame-3',
          file: 'apps/desktop/renderer/src/ui/layout/App.tsx',
          line: 96,
        },
      ]}
    />
  );
}
