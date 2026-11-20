import { HistoricalDiff } from '@archer/ui';

const unchangedLines = Array.from(
  { length: 12 },
  (_, index) => `const line${index + 1} = ${index + 1};`,
).join('\n');

/** 示例只使用固定文本，不读取文件或请求服务。 */
export default function Example({ state = 'default' }: { state?: string }) {
  if (state === 'unchanged')
    return <HistoricalDiff before={'const ready = true;\n'} after={'const ready = true;\n'} />;
  if (state === 'trimmed')
    return (
      <HistoricalDiff
        before={`${unchangedLines}\nconst ready = false;`}
        after={`${unchangedLines}\nconst ready = true;`}
      />
    );
  return <HistoricalDiff before={'const ready = false;\n'} after={'const ready = true;\n'} />;
}
