import { TestResults } from '@archer/ui';

/** 用例状态为固定数据，组件不执行测试。 */
const mixed = [
  {
    id: 'source-list',
    name: '来源列表渲染',
    status: 'passed' as const,
    suite: 'tests/ai-ui',
    duration: '12ms',
  },
  {
    id: 'cite-protocol',
    name: '无效引用协议不生成链接',
    status: 'failed' as const,
    suite: 'tests/ai-ui',
    duration: '8ms',
    detail: '期望输出中不含 href，实际仍包含 href。',
  },
  {
    id: 'stack-frames',
    name: '堆栈帧保留原始位置',
    status: 'skipped' as const,
    suite: 'tests/ai-ui',
  },
  {
    id: 'pending',
    name: '等待后续用例',
    status: 'running' as const,
    suite: 'tests/ai-ui',
  },
];
const completed = mixed
  .filter((item) => item.id !== 'pending')
  .map((item) => ({
    ...item,
    status: 'passed' as const,
    detail: undefined,
  }));
const failed = mixed
  .filter((item) => item.id !== 'pending')
  .map((item) => ({ ...item, status: 'failed' as const }));

/** 只切换固定用例状态，不运行测试或写入结果。 */
export default function Example({ state = 'default' }: { state?: string }) {
  const cases = state === 'completed' ? completed : state === 'error' ? failed : mixed;
  return <TestResults title="UI 行为验证" cases={cases} />;
}
