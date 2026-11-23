import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../primitives/Collapsible.js';
import type { ReactNode } from 'react';
import { Icon } from '../primitives/Icon.js';

export type TestStatus = 'passed' | 'failed' | 'skipped' | 'running';

export interface TestCaseView {
  id: string;
  name: string;
  status: TestStatus;
  /** 可选分组；只有宿主明确提供时才分组，不按名称前缀推断。 */
  suite?: string;
  duration?: string;
  /** 失败原因等已由宿主确认的附加信息。 */
  detail?: ReactNode;
}

const statusLabels: Record<TestStatus, string> = {
  passed: '通过',
  failed: '失败',
  skipped: '跳过',
  running: '运行中',
};

function statusIcon(status: TestStatus) {
  if (status === 'passed') return <Icon name="check" size="sm" />;
  if (status === 'failed') return <Icon name="alert" size="sm" />;
  return <Icon name="clock" size="sm" />;
}

/**
 * 测试结果只阅读宿主传入的用例和状态。
 * 组件不执行测试、不重算套件结论，汇总数量仅对传入用例计数。
 */
export function TestResults({
  title = '测试结果',
  cases,
  defaultOpen = true,
}: {
  title?: string;
  cases: readonly TestCaseView[];
  defaultOpen?: boolean;
}) {
  const passed = cases.filter((item) => item.status === 'passed').length;
  const failed = cases.filter((item) => item.status === 'failed').length;
  const skipped = cases.filter((item) => item.status === 'skipped').length;
  const running = cases.filter((item) => item.status === 'running').length;
  const suites = new Map<string, TestCaseView[]>();
  for (const item of cases) {
    const key = item.suite?.trim() ?? '';
    const list = suites.get(key) ?? [];
    list.push(item);
    suites.set(key, list);
  }
  return (
    <Collapsible className="ui-test-results" defaultOpen={defaultOpen}>
      <CollapsibleTrigger>
        <Icon name={failed > 0 ? 'alert' : running > 0 ? 'clock' : 'check'} size="sm" />
        <strong>{title}</strong>
        <span>{`${passed}/${cases.length} 通过`}</span>
        {failed > 0 && <small className="ui-test-failed">{failed} 失败</small>}
        {skipped > 0 && <small>{skipped} 跳过</small>}
        {running > 0 && <small>{running} 运行中</small>}
        <Icon name="chevron-right" size="sm" className="ui-disclosure-chevron" />
      </CollapsibleTrigger>
      <CollapsibleContent keepMounted>
        <div className="ui-test-results-body">
          {cases.length === 0 && <p className="ui-test-empty">未提供用例。</p>}
          {[...suites.entries()].map(([suite, items]) => (
            <section className="ui-test-suite" key={suite}>
              {suite && <h3>{suite}</h3>}
              <ol>
                {items.map((item) => (
                  <li className="ui-test-case" data-status={item.status} key={item.id}>
                    <span className="ui-test-case-status">
                      {statusIcon(item.status)}
                      <span>{statusLabels[item.status]}</span>
                    </span>
                    <span className="ui-test-case-name">{item.name}</span>
                    {item.duration && <small>{item.duration}</small>}
                    {item.detail && <div className="ui-test-case-detail">{item.detail}</div>}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
