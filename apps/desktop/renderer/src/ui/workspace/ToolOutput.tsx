/** 工具历史输出与已确认文件修改的共享展示。 */
import { useState } from 'react';
import { Button, Icon, HistoricalDiff } from '@archer/ui';

export function AppliedChange({ before, after, path }: { before?: string | null; after: string; path: string }) {
  // 缺少旧侧原文只能展示源码，不能把未知冒充整文件新增。
  return <div className="applied-change">
    <div className="diff-caption"><span>{before === undefined ? '已写入内容（未记录原文）' : '已应用修改'}</span><code>{path}</code></div>
    {before === undefined ? <HistoricalDiff path={path} after={after} />
      : <HistoricalDiff path={path} before={before ?? ''} after={after} />}
  </div>;
}

export function OutputBlock({ text }: { text: string }) {
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);
  // 空结果保留在事实中，展示层不生成空代码框和无意义复制入口。
  if (!text.length) return null;
  const clipped = !full && text.length > 16_000;
  return <div className="execution-output"><Button variant="ghost" size="icon-xs" aria-label="复制输出" title={copied ? '已复制' : '复制输出'} onClick={() => {
    void navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => setCopied(false));
  }}><Icon name={copied ? 'check' : 'copy'} size="xs" /></Button><pre>{clipped ? `${text.slice(0, 16_000)}\n…` : text}</pre>{clipped && <Button variant="link" size="xs" className="output-expand" onClick={() => setFull(true)}>展开剩余内容</Button>}</div>;
}
