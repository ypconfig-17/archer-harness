import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@archer/ui';
import { InvocationRow } from '../workspace/InvocationRow';
/** 检查面板的原始事件页签：把已提交事实翻译成中文摘要，原始 JSON 按需展开。 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentEvent, Snapshot } from '@archer/contracts';
import { eventNavigation, type EventFilter } from '../../lib/event-navigation';
import { turnNumber } from '../../lib/labels';
import { Icon } from '@archer/ui';
import { Button, Input, NativeSelect, SegmentedControl, Tabs } from '@archer/ui';
import { buildItems } from '../../lib/conversation';
import { operationState, operationSummary } from '../../lib/operation';

type TimelineEvent = Snapshot<AgentEvent>;
const FILTERS: readonly { key: EventFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'tools', label: '工具' },
  { key: 'inference', label: '模型' },
  { key: 'failure', label: '失败' },
  { key: 'attention', label: '需关注' },
  { key: 'human', label: '人工' },
  { key: 'agent', label: '会话' },
];

/** 调用表仅聚合已提交事实；不改变执行状态，也不以临时流补造结果。 */
export function EventPanel({ events, hasEarlier = false, selectedId, onSelect, visible = true }: {
  events: readonly TimelineEvent[];
  hasEarlier?: boolean;
  visible?: boolean;
  selectedId?: string;
  onSelect?(key: string | undefined): void;
}) {
  const [mode, setMode] = useState<'calls' | 'events'>('calls');
  const [query, setQuery] = useState('');
  useEffect(() => {
    // 对话定位必须回到调用视图，不能被之前的事件视图或搜索条件遮挡。
    if (selectedId) { setMode('calls'); setQuery(''); }
  }, [selectedId]);
  return <div className="invocation-inspector">
    <div className="activity-heading">
    <SegmentedControl label="活动视图" className="invocation-filters" value={mode} onChange={setMode}
      options={[{ value: 'calls', label: '调用' }, { value: 'events', label: '全部事件' }]} />
      <Input className="invocation-search" aria-label="搜索调用与事件" placeholder="搜索名称、参数、模型…" value={query} onChange={event => setQuery(event.target.value)} />
    </div>
    <div role="region" aria-label="调用" hidden={mode !== 'calls'}>
      <InvocationPanel visible={visible && mode === 'calls'} events={events} hasEarlier={hasEarlier} query={query} selectedId={selectedId} onSelect={onSelect} />
    </div>
    <div role="region" aria-label="全部事件" hidden={mode !== 'events'}>
      <EventFactsPanel visible={visible && mode === 'events'} events={events} hasEarlier={hasEarlier} query={query} />
    </div>
  </div>;
}

const InvocationPanel = memo(function InvocationPanel({ events, hasEarlier, query, selectedId: controlledId, onSelect, visible }: {
  events: readonly TimelineEvent[]; hasEarlier: boolean; query: string; visible: boolean;
  selectedId?: string; onSelect?(key: string | undefined): void;
}) {
  const [filter, setFilter] = useState('all');
  const [localId, setLocalId] = useState<string>();
  const selectedId = onSelect ? controlledId : localId;
  const setSelectedId = onSelect ?? setLocalId;
  const [detail, setDetail] = useState<'input' | 'output' | 'facts'>('input');
  useEffect(() => {
    if (controlledId) setFilter('all');
  }, [controlledId]);
  const calls = useMemo(() => !visible ? [] : buildItems(events).flatMap(item =>
    item.kind === 'effect' && (item.entry.effectType === 'CALL' || item.entry.effectType === 'INFER')
      ? [{ ...item, key: `${item.turnId}/${item.entry.effectId}` }] : []), [events, visible]);
  // 空搜索直接通过，不序列化包含完整模型请求的 Effect。
  const matching = calls.filter(item => {
    const state = operationState(item.entry);
    const summary = operationSummary(item.entry);
    return (filter === 'all' || filter === 'failure' && state.tone === 'error'
        || item.entry.effectType === filter)
      && (!query.trim() || `${summary.title} ${summary.target} ${JSON.stringify(item.entry.effect ?? {})}`.toLowerCase().includes(query.toLowerCase()));
  });
  // 选择绑定稳定调用身份；后台追加或筛选变化不会替用户选择另一条记录。
  const selected = calls.find(item => item.key === selectedId);
  const related = selected ? events.filter(event => event.fact.scope === 'turn'
    && event.fact.turnId === selected.turnId && 'effectId' in event.fact.event.data
    && event.fact.event.data.effectId === selected.entry.effectId) : [];
  if (!visible) return null;
  return <div className="event-panel">
    <div className="event-view-toolbar invocation-toolbar">
      <SegmentedControl label="筛选调用" className="invocation-filters" value={filter} onChange={setFilter}
        options={[
          { value: 'all', label: '全部' },
          { value: 'INFER', label: '模型' },
          { value: 'CALL', label: '工具' },
          { value: 'failure', label: '失败' },
        ]} />
      <p className="event-range">已加载 {calls.length} 次调用 · {matching.length} 次匹配{hasEarlier ? ' · 更早记录尚未加载' : ''}</p>
    </div>
    <div className={`activity-browser${selected ? ' has-selection' : ''}`}>
      <div className="event-list invocation-list">
        <div className="invocation-row invocation-columns" aria-hidden="true"><span>时间</span><span>类型</span><span>名称 / 参数摘要</span><span>状态</span><span>耗时</span><span>Token 入 / 出</span></div>
        {matching.map((item, index) => {
          const { entry } = item;
          return <InvocationRow key={item.key} entry={entry} seq={item.seq} selected={selectedId === item.key}
            onSelect={() => setSelectedId(item.key)} onKeyDown={event => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              event.preventDefault();
              const next = matching[index + (event.key === 'ArrowDown' ? 1 : -1)];
              if (next) {
                setSelectedId(next.key);
                const sibling = event.key === 'ArrowDown' ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling;
                if (sibling instanceof HTMLButtonElement) sibling.focus();
              }
            }} />;
        })}
        {!matching.length && <p className="event-empty">没有匹配的已提交调用。</p>}
      </div>
      {selectedId && !selected && <p className="event-range">所选调用尚未加载，请加载对应历史记录。</p>}
      {selected && <section className="activity-record-detail" aria-label="调用详情">
        <header><h3>{selected.entry.effectType === 'INFER' ? '模型推理' : operationSummary(selected.entry).title}</h3>
          <Button variant="ghost" size="xs" aria-label="关闭调用详情" onClick={() => setSelectedId(undefined)}><Icon name="x" size="sm" /></Button></header>
        <p className="event-range">{operationState(selected.entry).label} · 任务 {turnNumber(selected.turnId)} · #{selected.seq}</p>
        <Tabs label="调用详情内容" value={detail} onChange={setDetail} tabIdPrefix="invocation-detail" panelIdPrefix="invocation-body"
          items={[{ value: 'input', label: '输入' }, { value: 'output', label: '输出' }, { value: 'facts', label: '指标与事实' }]} />
        {(['input', 'output', 'facts'] as const).map(tab => <div key={tab} role="tabpanel" id={`invocation-body-${tab}`} aria-labelledby={`invocation-detail-${tab}`} hidden={detail !== tab}>
          {tab === 'input' && <><p className="event-range">模型请求按实际提交快照列出；未记录的内容不补造。</p><pre>{JSON.stringify(selected.entry.effectType === 'INFER' ? selected.entry.inferenceRequests?.map(request => ({ requestId: request.requestId, purpose: request.purpose, request: request.request })) ?? '未加载实际请求快照' : selected.entry.effect, null, 2)}</pre></>}
          {tab === 'output' && <pre>{JSON.stringify(selected.entry.end ?? '尚无已提交结果', null, 2)}</pre>}
          {tab === 'facts' && <><p className="event-range">用量、来源与错误以已提交原始事实为准；缺失指标不估算。</p><pre>{JSON.stringify(related, null, 2)}</pre></>}
        </div>)}
      </section>}
    </div>
  </div>;
}, (previous, next) => {
  // 隐藏子视图保留 DOM 和选择状态，不随外层事件或搜索更新执行投影。
  if (!next.visible) return true;
  return previous.visible === next.visible && previous.events === next.events
    && previous.hasEarlier === next.hasEarlier && previous.query === next.query
    && previous.selectedId === next.selectedId && previous.onSelect === next.onSelect;
});

const EventFactsPanel = memo(function EventFactsPanel({ events, hasEarlier = false, query, visible }: { events: readonly TimelineEvent[]; hasEarlier?: boolean; query: string; visible: boolean }) {
  const [filter, setFilter] = useState<EventFilter>('all');
  const [toolKey, setToolKey] = useState('');
  const { rows, groups } = useMemo(() => {
    if (!visible) return { rows: [], groups: [] };
    const term = query.toLowerCase();
    const matching = query ? events.filter(event => JSON.stringify(event).toLowerCase().includes(term)) : events;
    return eventNavigation(matching, filter, toolKey);
  }, [events, filter, toolKey, query, visible]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = groups.flatMap(group => group.rows).find(row => row.event.id === selectedId);
  const sourceButton = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // 只有主动选择对象才进入详情焦点；后台追加记录不抢走用户阅读位置。
    if (selectedId) heading.current?.focus({ preventScroll: true });
    else sourceButton.current?.focus({ preventScroll: true });
  }, [selectedId]);
  const renderRow = ({ event, view }: typeof rows[number]) => (
    <Button variant="ghost" className="activity-record" key={event.id}
      aria-pressed={selectedId === event.id} aria-label={`查看${view.title}，记录 ${event.seq}`}
      onClick={action => {
        sourceButton.current = action.currentTarget;
        setSelectedId(event.id);
      }}>
      <span className={`event-dot is-${view.tone}`} aria-hidden="true" />
      <span className="activity-record-copy">
        <strong>{view.title}</strong>
        {view.summary && <small title={view.summary}>{view.summary}</small>}
      </span>
      <time title={new Date(event.ts).toLocaleString('zh-CN', { hour12: false })}>
        {new Date(event.ts).toLocaleTimeString('zh-CN', { hour12: false })}
      </time>
      <span className="event-seq">#{event.seq}</span>
      <Icon name="chevron-right" size="xs" />
    </Button>
  );
  if (!visible) return null;
  return <div className="event-panel">
    <div className="event-view-toolbar invocation-toolbar" role="group" aria-label="运行事件工具栏">
      <SegmentedControl label="筛选运行事件" className="invocation-filters" value={filter}
        onChange={value => {
          setFilter(value);
          setToolKey('');
        }}
        options={FILTERS.map(item => ({ value: item.key, label: item.label }))} />
      <p className="event-range">已加载 {events.length} 条记录{hasEarlier ? ' · 更早记录尚未加载' : ''}</p>
      {filter === 'tools' && <label className="event-filter-select">
        <span>工具</span>
        <NativeSelect aria-label="按具体工具筛选" value={toolKey} onChange={event => setToolKey(event.target.value)}>
          <option value="">全部工具与能力</option>
          {[...new Map(rows.filter(row => row.toolKey).map(row => [row.toolKey!, row.toolLabel!])).entries()].map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </NativeSelect>
      </label>}
    </div>
    <div className={`activity-browser${selected ? ' has-selection' : ''}`}>
    {groups.length === 0
      ? <p className="event-empty">{events.length === 0 ? '还没有已提交的事件。' : '该类别下没有事件。'}</p>
      : <div className="event-list">
        {groups.map((group, index) => (
          <Collapsible
            className="event-batch"
            key={`${filter}:${group.rows[0].event.seq}`}
            defaultOpen={filter !== 'all' || index === groups.length - 1}
          >
            <CollapsibleTrigger>
              <Icon name="chevron-right" size="xs" />
              <strong>{group.label}</strong>
              <span>{group.rows.length} 条记录</span>
              {group.status && <small>{group.status}</small>}
            </CollapsibleTrigger>
            <CollapsibleContent keepMounted>
              {group.interactions.map(interaction => (
                <Collapsible
                  className="event-interaction"
                  key={`${filter}:${interaction.rows[0].event.seq}`}
                  defaultOpen={filter === 'failure' || filter === 'human' || filter === 'attention'}
                >
                  <CollapsibleTrigger>
                    <Icon name="chevron-right" size="xs" />
                    <span className="event-interaction-label">
                      <strong>{interaction.id === 'unlinked'
                        ? [...new Set(interaction.rows.map(row => row.view.title))].slice(0, 2).join(' · ')
                        : interaction.title}</strong>
                      {interaction.target && <span title={interaction.target}>{interaction.target}</span>}
                    </span>
                    <small>{interaction.state}</small>
                    <span>{interaction.rows.length} 条</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent keepMounted>
                    {interaction.rows.map(renderRow)}
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>}
    {selected && <section className="activity-record-detail" aria-label="活动详情">
      <header>
        <h3 ref={heading} tabIndex={-1}>{selected.view.title}</h3>
        <Button variant="ghost" size="icon-sm" aria-label="关闭活动详情" onClick={() => {
          setSelectedId(null);
        }}><Icon name="x" size="sm" /></Button>
      </header>
      <EventRecordDetail row={selected} />
    </section>}
    </div>
  </div>;
}, (previous, next) => {
  // 隐藏子视图保留 DOM 和选择状态，不随外层事件或搜索更新执行投影。
  if (!next.visible) return true;
  return previous.visible === next.visible && previous.events === next.events
    && previous.hasEarlier === next.hasEarlier && previous.query === next.query;
});

/** 详情只投影选中事实；参数、结果与原始记录保持原文，不推断调用是否成功。 */
export function EventRecordDetail({ row }: { row: ReturnType<typeof eventNavigation>['rows'][number] }) {
  const { event, view } = row;
  return <div className="event-body">
    <p className="event-range">记录 #{event.seq} · {new Date(event.ts).toLocaleString('zh-CN', { hour12: false })}
      {event.fact.scope === 'turn' ? ` · 任务 ${turnNumber(event.fact.turnId)}` : ' · 会话记录'}
    </p>
    {view.summary && <p>{view.summary}</p>}
    {view.fields.length > 0 && <dl className="event-fields">
      {view.fields.map((field, index) => <div key={`${field.label}:${index}`}>
        <dt>{field.label}</dt>
        <dd className={field.mono ? 'is-mono' : undefined}>{field.value}</dd>
      </div>)}
    </dl>}
    <Collapsible className="event-raw">
      <CollapsibleTrigger>原始 JSON</CollapsibleTrigger>
      <CollapsibleContent keepMounted>
        <pre>{JSON.stringify(event, null, 2)}</pre>
      </CollapsibleContent>
    </Collapsible>
  </div>;
}
