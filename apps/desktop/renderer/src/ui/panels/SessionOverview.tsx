/** 会话概览只列当前会话已知的字段，不推算进度或结果。 */
export function SessionOverview({ workspace, execution, records, task, queued, changedFiles }: {
  workspace: string;
  execution: string;
  records: number;
  task: string;
  queued: number;
  changedFiles: number;
}) {
  const facts = [
    { label: '工作区', value: workspace, mono: true },
    { label: '执行状态', value: execution },
    { label: '当前任务', value: task },
    { label: '已提交记录', value: `${records} 条` },
    { label: '排队任务', value: `${queued} 项` },
    { label: '本轮修改', value: changedFiles ? `${changedFiles} 个文件` : '暂无变更' },
  ];
  return (
    <section className="workbench-overview" aria-label="会话概览">
      <dl className="workbench-facts">
        {facts.map(fact => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd className={fact.mono ? 'is-mono' : undefined}>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
