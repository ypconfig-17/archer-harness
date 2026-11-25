/** 上下文扫描页：按已提交的模型请求快照查看字符组成、条目与整理事实。 */
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ContextPlan } from '@archer/contracts';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Icon,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  NativeSelect,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ScrollArea,
  SegmentedControl,
  Tabs,
  Tooltip,
} from '@archer/ui';
import { capabilityLabel } from '../../lib/capability';
import { contextComposition, type CompositionKey } from '../../lib/context-composition';
import {
  contextEntryGroups,
  ROLES,
  type ContextSelection,
  type EntryCategory,
} from '../../lib/context-entries';
import { contextRequests, type ContextRequest } from '../../lib/context-requests';
import { compactTokens, contextTrend, type TrendPoint } from '../../lib/context-trend';
import { buildItems, type TimelineEvent } from '../../lib/conversation';
import { turnNumber } from '../../lib/labels';
import { REASONING_LABELS } from '../../lib/model-selection';
import { OutputBlock } from '../workspace/ToolOutput';

const STEP_TITLES: Record<ContextPlan['steps'][number]['kind'], string> = {
  compact: '历史摘要压缩',
  'trim-tool-results': '超窗工具结果节选',
};
const REASONS: Record<ContextPlan['steps'][number]['reason'], string> = {
  capacity: '容量线',
  growth: '增长线',
  overflow: '超窗',
};
type EntryFilter = 'all' | EntryCategory;
const FILTERS: readonly { value: EntryFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'messages', label: '消息' },
  { value: 'tools', label: '工具' },
  { value: 'references', label: '参考' },
];
type ContextView = 'structure' | 'raw';
/** 条带点击只切到对应筛选并展开分组，不改变选择与请求快照。 */
const SLICE_TARGETS: Record<CompositionKey, { filter: EntryFilter; groups: readonly string[] }> = {
  conversation: { filter: 'messages', groups: ['user', 'assistant'] },
  results: { filter: 'tools', groups: ['results'] },
  declarations: { filter: 'tools', groups: ['declarations'] },
  system: { filter: 'messages', groups: ['system'] },
  references: { filter: 'references', groups: ['references'] },
};
type RequestMessage = ContextRequest['effect']['messages'][number];
type RequestTool = NonNullable<ContextRequest['effect']['tools']>[number];
type RequestToolCall = NonNullable<RequestMessage['toolCalls']>[number];

function requestState(context: ContextRequest): string {
  if (!context.sent) return '待执行意图';
  if (context.failed) return '请求失败';
  if (context.purpose === 'compaction') {
    return context.adopted ? '摘要已采用' : context.responded ? '已响应，未确认采用' : '等待响应';
  }
  return context.responded ? '已响应' : '等待响应';
}

function requestKind(context: ContextRequest): string {
  if (!context.sent) return '待执行意图';
  return context.purpose === 'compaction' ? '摘要请求' : '模型请求';
}

/** 趋势柱的提示只补充请求身份与真实输入 Token，不展示按字符分摊的分类假值。 */
function trendLabel(point: TrendPoint, requests: readonly ContextRequest[]): string {
  const request = requests[point.requestIndex];
  const head = request ? `任务 ${turnNumber(request.turnId)} · ${requestKind(request)}` : point.label;
  return point.tokens === undefined ? `${head} · 暂无用量` : `${head} · 输入 ${point.tokens.toLocaleString()} tokens`;
}

/** 与上一次请求比较真实输入 Token；当前或上一次缺失用量时明确说明，不按零计算。 */
function trendDeltaText(
  hasCurrentUsage: boolean,
  delta: number | undefined,
  hasPrevious: boolean,
  previousTokens: number | undefined,
): {
  text: string;
  tone: '' | 'flat' | 'down' | 'up';
} {
  if (!hasCurrentUsage) {
    return { text: '当前请求无用量', tone: '' };
  }
  if (delta === undefined) {
    return { text: hasPrevious ? '上次无用量' : '首次请求', tone: '' };
  }
  if (delta === 0) return { text: '与上次持平', tone: 'flat' };
  const change = delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString();
  const share = previousTokens
    ? ` ${Math.abs(delta / previousTokens * 100).toFixed(1)}%（${change}）`
    : ` ${change}`;
  return { text: `较上次 ${delta < 0 ? '↓' : '↑'}${share}`, tone: delta < 0 ? 'down' : 'up' };
}

/** 只比较显式身份：消息与工具按快照下标，参考与整理事实按条目种类。 */
function selectionMatches(selected: ContextSelection | null, candidate: ContextSelection): boolean {
  if (selected?.kind !== candidate.kind) return false;
  if (selected.kind === 'message' && candidate.kind === 'message') return selected.index === candidate.index;
  if (selected.kind === 'tool' && candidate.kind === 'tool') return selected.index === candidate.index;
  return true;
}

export const ContextPanel = memo(function ContextPanel({ events, hasEarlier = false, visible = true }: {
  events: readonly TimelineEvent[];
  hasEarlier?: boolean;
  visible?: boolean;
}) {
  const requests = useMemo(
    // 隐藏时保留选择状态，但不构建请求投影或原始内容。
    () => visible ? contextRequests(buildItems(events).flatMap(item => item.kind === 'effect' ? [item.entry] : [])) : [],
    [events, visible],
  );
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const [selection, setSelection] = useState<ContextSelection | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<EntryFilter>('all');
  const [view, setView] = useState<ContextView>('structure');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [compositionOpen, setCompositionOpen] = useState(true);
  const [trendWindow, setTrendWindow] = useState(9);
  const heading = useRef<HTMLHeadingElement>(null);
  const entries = useRef<HTMLElement>(null);
  const sourceButton = useRef<HTMLElement | null>(null);
  // 选择键可能指向已被窗口裁掉的请求；此时回落到最新快照，避免下拉框停在无效值。
  const activeKey = requestKey && requests.some(request => request.key === requestKey) ? requestKey : null;
  const context = activeKey === null
    ? requests.at(-1)
    : requests.find(request => request.key === activeKey);
  const composition = useMemo(() => context ? contextComposition(context) : [], [context]);
  const groups = useMemo(() => context ? contextEntryGroups(context) : [], [context]);
  const trend = useMemo(() => contextTrend(requests, trendWindow), [requests, trendWindow]);
  useEffect(() => {
    if (selection) heading.current?.focus({ preventScroll: true });
  }, [selection]);
  if (!visible) return null;
  if (!context) {
    return <div className="context-empty">
      <Icon name="file" size="lg" />
      <h3>尚无推理上下文</h3>
      <p>模型发起推理后，这里展示请求中的消息、工具与参考。</p>
      {hasEarlier && <p>可加载更早记录，查看之前的推理请求。</p>}
    </div>;
  }

  const { effect, usage, preparations, reasoningLevel, purpose, contextPlan } = context;
  const index = requests.indexOf(context);
  const term = search.trim().toLocaleLowerCase();
  const filteredGroups = groups
    .filter(group => filter === 'all' || group.category === filter)
    .map(group => ({
      ...group,
      entries: group.entries.filter(entry => !term || entry.searchText.toLocaleLowerCase().includes(term)),
    }))
    .filter(group => group.entries.length > 0);
  const entryCount = groups.reduce((sum, group) => sum + group.entries.length, 0);
  const systemCount = effect.messages.filter(message => message.role === 'system').length;
  const toolCount = effect.tools?.length ?? 0;
  const selectedMessage = selection?.kind === 'message' ? effect.messages[selection.index] : undefined;
  const selectedTool = selection?.kind === 'tool' ? effect.tools?.[selection.index] : undefined;
  const detail = describeSelection(selection, selectedMessage, selectedTool, context);
  const compactions = requests.filter(request => request.purpose === 'compaction' && request.key !== context.key);
  const cacheShare = usage?.cacheReadTokens !== undefined && usage.promptTokens > 0
    ? `${(usage.cacheReadTokens / usage.promptTokens * 100).toFixed(1)}%`
    : '';
  // 原始 JSON 只在用户实际打开该视图时生成，不缓存新建的投影对象。
  const raw = view === 'raw' ? JSON.stringify({
    requestId: context.requestId,
    purpose,
    requestedAt: context.requestedAt,
    effect,
    usage,
    preparations,
    reasoningLevel,
    contextPlan,
    summary: context.summary,
    compactedAt: context.compactedAt,
  }, null, 2) : '';
  const inputShare = usage && contextPlan?.inputLimit && contextPlan.inputLimit > 0
    ? `占额度 ${(usage.promptTokens / contextPlan.inputLimit * 100).toFixed(1)}%（${contextPlan.inputLimit.toLocaleString()}）`
    : undefined;
  const metrics: { label: string; value: string; note: string; hint?: string }[] = [
    {
      label: '输入 Token',
      value: usage ? usage.promptTokens.toLocaleString() : '—',
      note: inputShare ?? (usage ? '本次请求返回用量' : contextPlan?.inputLimit ? `额度 ${contextPlan.inputLimit.toLocaleString()} · 暂无返回用量` : '暂无返回用量'),
      hint: inputShare ? '输入 Token ÷ 模型输入额度' : undefined,
    },
    { label: '消息数量', value: String(effect.messages.length), note: `系统指令 ${systemCount} 条` },
    { label: '工具声明', value: String(toolCount), note: '原生 tools 通道' },
    {
      label: '缓存 Token',
      value: usage?.cacheReadTokens !== undefined ? usage.cacheReadTokens.toLocaleString() : '—',
      note: cacheShare ? `占输入 ${cacheShare}` : '暂无缓存读数',
      hint: '缓存读 Token ÷ 输入 Token',
    },
  ];

  const previousTokens = requests[index - 1]?.usage?.promptTokens;
  const trendDelta = usage && previousTokens !== undefined ? usage.promptTokens - previousTokens : undefined;
  const delta = trendDeltaText(Boolean(usage), trendDelta, index > 0, previousTokens);
  const trendMax = trend.max || 1;
  const trendHasUsage = trend.points.some(point => point.tokens !== undefined);
  const trendActiveIndex = trend.points.findIndex(point => point.key === context.key);
  const trendActive = trendActiveIndex >= 0 ? trend.points[trendActiveIndex] : undefined;
  const trendX = (position: number) => ((position + 0.5) / trend.points.length) * 100;
  const trendY = (tokens: number) => (1 - tokens / trendMax) * 100;
  // 首尾柱的数值气泡改为向内对齐，避免图表铺满整行后气泡越过内容边界被裁切。
  const trendBadgeEdge = trendActiveIndex < 0
    ? ''
    : trendX(trendActiveIndex) > 88 ? ' is-end' : trendX(trendActiveIndex) < 12 ? ' is-start' : '';
  // 柱数多时按总量动态抽稀至最多约 9 个刻度，当前请求始终保留且避开紧邻刻度，防止文字重叠。
  const trendLabelStep = trend.points.length > 10 ? Math.ceil(trend.points.length / 9) : 1;

  function choose(next: ContextSelection, source?: HTMLElement) {
    if (source) sourceButton.current = source;
    setSelection(next);
  }
  function chooseRequest(key: string) {
    setRequestKey(key || null);
    setSelection(null);
    setSearch('');
    setFilter('all');
    // 分组展开属于单个请求快照的阅读状态；换请求后回到统一的收起默认值。
    setOpenGroups({});
  }
  function moveRequest(delta: number) {
    const target = requests[index + delta];
    if (target) chooseRequest(target.key);
  }
  function locateSlice(key: CompositionKey) {
    const target = SLICE_TARGETS[key];
    setFilter(target.filter);
    setSelection(null);
    setSearch('');
    setOpenGroups(current => ({
      ...current,
      ...Object.fromEntries(target.groups.map(group => [group, true])),
    }));
    entries.current?.scrollIntoView({ block: 'start' });
  }
  function closeDetail() {
    const previous = sourceButton.current;
    setSelection(null);
    requestAnimationFrame(() => previous?.focus());
  }

  return <div className="context-panel">
    <header className="context-head">
      <Tooltip label="查看模型本次请求实际携带的上下文，以及各类内容的字符占用。" side="right">
        <span className="context-head-mark" aria-hidden="true"><Icon name="drive" size="md" /></span>
      </Tooltip>
      <div className="context-head-text">
        <h2>上下文扫描</h2>
      </div>
      <div className="context-request">
        <label className="context-select">
          <span>请求</span>
          <NativeSelect aria-label="选择模型请求" value={activeKey ?? ''} onChange={event => chooseRequest(event.target.value)}>
            <option value="">最近请求（随记录更新）</option>
            {requests.map((request, position) => <option key={request.key} value={request.key}>
              任务 {turnNumber(request.turnId)} · {requestKind(request)} {position + 1}
            </option>)}
          </NativeSelect>
        </label>
        <span className="context-position">#{index + 1} / {requests.length}</span>
        <Tooltip label="上一个请求">
          <Button variant="ghost" size="icon-sm" aria-label="上一个请求" disabled={index <= 0} onClick={() => moveRequest(-1)}>
            <Icon name="chevron-left" size="sm" />
          </Button>
        </Tooltip>
        <Tooltip label="下一个请求">
          <Button variant="ghost" size="icon-sm" aria-label="下一个请求" disabled={index >= requests.length - 1} onClick={() => moveRequest(1)}>
            <Icon name="chevron-right" size="sm" />
          </Button>
        </Tooltip>
        <span className="context-range">已加载 {requests.length} 个请求{hasEarlier ? ' · 更早记录尚未加载' : ''}</span>
      </div>
    </header>
    <div className="context-metrics" role="group" aria-label="本次请求指标">
      {metrics.map(metric => <div key={metric.label} className="context-metric">
        <span className="context-metric-label">{metric.label}</span>
        <strong className="context-metric-value">{metric.value}</strong>
        {metric.hint
          ? <Tooltip label={metric.hint}><span className="context-metric-note" tabIndex={0}>{metric.note}</span></Tooltip>
          : <span className="context-metric-note">{metric.note}</span>}
      </div>)}
    </div>
    <Tabs<ContextView>
      label="上下文视图"
      value={view}
      items={[{ value: 'structure', label: '结构' }, { value: 'raw', label: '原始内容' }]}
      onChange={setView}
      tabIdPrefix="context-view-tab"
      panelIdPrefix="context-view-panel"
      className="context-views-tabs"
    />
    <div
      id="context-view-panel-structure"
      role="tabpanel"
      aria-labelledby="context-view-tab-structure"
      className="context-views"
      hidden={view !== 'structure'}
    >
      <ResizablePanelGroup orientation="horizontal" className="context-split">
        <ResizablePanel defaultSize="66" minSize="42" className="context-split-panel">
          <ScrollArea className="context-scroll">
            <div className="context-scan">
              <Collapsible
                render={<section aria-label="字符占用" />}
                className="context-section"
                open={compositionOpen}
                onOpenChange={setCompositionOpen}
              >
                <header className="context-section-head">
                  <CollapsibleTrigger className="context-section-trigger">
                    <Icon name="chevron-right" size="xs" className="context-section-chevron" />
                    <h3>字符占用</h3>
                  </CollapsibleTrigger>
                </header>
                <CollapsibleContent>
                  <div className="context-composition-strip" aria-hidden="true">
                    {composition
                      .filter(slice => slice.share > 0)
                      .map(slice => <span
                        key={slice.key}
                        className={`context-composition-seg is-${slice.key}`}
                        style={{ width: `${slice.share}%` }}
                      />)}
                  </div>
                  <div className="context-bars">
                    {composition.map(slice => <Tooltip key={slice.key} label={`只看${slice.label}条目`} side="right">
                      <Button variant="ghost" className="context-bar-row" onClick={() => locateSlice(slice.key)}>
                        <span className={`context-bar-dot is-${slice.key}`} />
                        <span className="context-bar-label">
                          <span>{slice.label}</span>
                          <span className="context-bar-note">{slice.note}</span>
                        </span>
                        <span className="context-bar-track">
                          <span className={`context-bar-fill is-${slice.key}`} style={{ width: `${slice.share}%` }} />
                        </span>
                        <span className="context-bar-value">
                          {slice.share.toFixed(1)}%
                          <span className="context-bar-chars">{slice.chars.toLocaleString()} 字符</span>
                        </span>
                      </Button>
                    </Tooltip>)}
                  </div>
                  <p className="context-note">按请求快照中的字符数统计，不等同于模型 Token。</p>
                </CollapsibleContent>
              </Collapsible>
              <section className="context-section context-trend" aria-label="Token 趋势">
                <header className="context-section-head">
                  <h3>上下文 Token 趋势</h3>
                  <label className="context-trend-window">
                    <NativeSelect
                      aria-label="趋势范围"
                      value={String(trendWindow)}
                      onChange={event => setTrendWindow(Number(event.target.value))}
                    >
                      <option value="9">最近 9 次</option>
                      <option value="18">最近 18 次</option>
                      <option value="0">全部请求</option>
                    </NativeSelect>
                  </label>
                </header>
                <div className="context-trend-body">
                  <p className="context-trend-summary">
                    <span className="context-trend-summary-label">当前请求 #{index + 1}</span>
                    <strong className="context-trend-summary-value">{usage ? usage.promptTokens.toLocaleString() : '—'}</strong>
                    <span className="context-trend-summary-unit">tokens</span>
                    <span className={`context-trend-delta${delta.tone ? ` is-${delta.tone}` : ''}`}>{delta.text}</span>
                  </p>
                  {trendHasUsage ? <div
                    className="context-trend-chart"
                    style={{ '--trend-count': trend.points.length } as CSSProperties}
                  >
                    <div className="context-trend-axis" aria-hidden="true">
                      <span>{compactTokens(trendMax)}</span>
                      <span>{compactTokens(Math.round(trendMax / 2))}</span>
                      <span>0</span>
                    </div>
                    <div className="context-trend-plot">
                      <span className="context-trend-grid" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </span>
                      {trend.points.map(point => <Tooltip key={point.key} label={trendLabel(point, requests)}>
                        <Button variant="ghost"
                          type="button"
                          className={`context-trend-bar${point.key === context.key ? ' is-current' : ''}`}
                          aria-label={trendLabel(point, requests)}
                          aria-pressed={point.key === context.key}
                          onClick={() => {
                            if (point.key !== context.key) chooseRequest(point.key);
                          }}
                        >
                          {point.tokens === undefined
                            ? <span className="context-trend-missing" />
                            : <span
                                className="context-trend-stack"
                                style={{ height: `${point.tokens / trendMax * 100}%` }}
                              >
                                {point.segments
                                  .filter(segment => segment.share > 0)
                                  .map(segment => <span
                                    key={segment.key}
                                    className={`context-trend-seg is-${segment.key}`}
                                    style={{ height: `${segment.share}%` }}
                                  />)}
                              </span>}
                        </Button>
                      </Tooltip>)}
                      <span className="context-trend-overlay" aria-hidden="true">
                        {trendActive?.tokens !== undefined && <span
                          className={`context-trend-badge${trendBadgeEdge}`}
                          style={{ left: `${trendX(trendActiveIndex)}%`, top: `${trendY(trendActive.tokens)}%` }}
                        >{trendActive.tokens.toLocaleString()}</span>}
                      </span>
                    </div>
                    <div className="context-trend-labels" aria-hidden="true">
                      {trend.points.map((point, position) => {
                        const isCurrent = point.key === context.key;
                        const nearCurrent = !isCurrent && trendActiveIndex >= 0
                          && Math.abs(position - trendActiveIndex) < Math.max(1, Math.ceil(trendLabelStep * 0.7));
                        const sparse = !isCurrent && ((trend.points.length - 1 - position) % trendLabelStep !== 0 || nearCurrent);
                        const edge = position === trend.points.length - 1 ? ' is-end' : position === 0 ? ' is-start' : '';
                        return <span
                          key={point.key}
                          className={`${isCurrent ? 'is-current' : ''}${sparse ? ' is-sparse' : ''}${edge}`}
                        >{point.label}</span>;
                      })}
                    </div>
                  </div> : <p className="context-trend-empty">暂无可对比的已提交用量。</p>}
                </div>
                <div className="context-trend-legend">
                  {composition.map(slice => <span key={slice.key}>
                    <span className={`context-bar-dot is-${slice.key}`} />
                    {slice.label}
                  </span>)}
                </div>
                <p className="context-note">
                  输入总量来自已提交 usage；分类分段按请求快照字符占比分摊，只示意构成，不是模型实际分类用量。
                </p>
              </section>
              <section className="context-section context-entries" aria-label="上下文条目" ref={entries}>
                <header className="context-section-head">
                  <h3>上下文条目</h3>
                  <span className="context-section-note">{entryCount} 条记录</span>
                </header>
                <div className="context-entries-tools">
                  <label className="context-search">
                    <Icon name="search" size="sm" />
                    <Input
                      aria-label="搜索上下文条目"
                      placeholder="搜索消息、工具与参考…"
                      value={search}
                      onChange={event => setSearch(event.target.value)}
                    />
                  </label>
                  <SegmentedControl label="条目类别" value={filter} options={FILTERS} onChange={setFilter} />
                </div>
                <div className="context-groups">
                  {filteredGroups.map(group => <Collapsible
                    key={group.key}
                    className="context-group"
                    open={Boolean(term) || openGroups[group.key] === true}
                    onOpenChange={open => setOpenGroups(current => ({ ...current, [group.key]: open }))}
                  >
                    <CollapsibleTrigger className="context-group-trigger">
                      <Icon name={group.icon} size="sm" />
                      <span className="context-group-title">{group.title}</span>
                      <span className="context-group-count">{group.entries.length} {group.unit}</span>
                      <Icon name="chevron-right" size="xs" className="context-group-chevron" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="context-group-body">
                      <div className="context-list">
                        {group.entries.map(entry => <Item
                          key={entry.key}
                          size="xs"
                          className="context-row"
                          render={<button type="button" />}
                          aria-pressed={selectionMatches(selection, entry.selection)}
                          onClick={event => choose(entry.selection, event.currentTarget)}
                        >
                          <ItemMedia variant="icon"><Icon name={entry.icon} size="sm" /></ItemMedia>
                          <ItemContent>
                            <ItemTitle>{entry.title}</ItemTitle>
                            <ItemDescription title={entry.description}>{entry.description}</ItemDescription>
                          </ItemContent>
                          {entry.meta && <ItemActions>
                            <span className="context-row-meta" title={entry.meta}>{entry.meta}</span>
                          </ItemActions>}
                        </Item>)}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>)}
                  {!filteredGroups.length && <p className="context-note">{term ? '没有匹配的条目。' : '该类别下没有条目。'}</p>}
                </div>
              </section>
            </div>
          </ScrollArea>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="34" minSize={260} maxSize="50" className="context-split-panel">
          <ScrollArea className="context-scroll">
            <div className="context-inspector">
              <section className="context-inspector-block" aria-label="请求概览">
                <header className="context-inspector-head">
                  <h3>请求概览</h3>
                  <span className={`context-state${context.failed ? ' is-failed' : ''}`}>{requestState(context)}</span>
                </header>
                <dl className="context-facts">
                  <div><dt>请求目的</dt><dd>{purpose === 'compaction' ? '上下文摘要' : purpose === 'agent' ? '任务推理' : '尚未形成实际请求'}</dd></div>
                  <div><dt>提交时间</dt><dd>{context.requestedAt ? new Date(context.requestedAt).toLocaleString('zh-CN', { hour12: false }) : '请求时间未记录'}</dd></div>
                  <div><dt>推理入口</dt><dd>{capabilityLabel(effect.target)}</dd></div>
                  <div><dt>模型</dt><dd>{effect.config?.model ?? '未声明'}</dd></div>
                  <div><dt>固定前缀</dt><dd>{effect.promptPrefixCount} 条消息</dd></div>
                  <div><dt>推理等级</dt><dd>{reasoningLevel ? REASONING_LABELS[reasoningLevel] : '未声明'}</dd></div>
                  <div><dt>返回用量</dt><dd>{usage
                    ? `输入 ${usage.promptTokens.toLocaleString()} · 输出 ${usage.completionTokens.toLocaleString()} tokens · 缓存读 ${usage.cacheReadTokens?.toLocaleString() ?? '未知'} / 写 ${usage.cacheWriteTokens?.toLocaleString() ?? '未知'}`
                    : '暂无返回用量'}</dd></div>
                  {effect.contextProjection && <div>
                    <dt>消息投影</dt>
                    <dd>摘要替换 {effect.contextProjection.summarizedMessages} 条 · {effect.contextProjection.originalChars.toLocaleString()} → {effect.contextProjection.projectedChars.toLocaleString()} 字符</dd>
                  </div>}
                </dl>
              </section>
              <section className="context-inspector-block" aria-label="已选上下文">
                <header className="context-inspector-head">
                  <h3 ref={heading} className="context-detail-title" tabIndex={-1}>{detail ? detail.title : '已选上下文'}</h3>
                  {detail && <Button variant="ghost" size="icon-sm" aria-label="关闭上下文详情" onClick={closeDetail}>
                    <Icon name="x" size="sm" />
                  </Button>}
                </header>
                <div className="context-detail-body">
                  {detail ? detail.body : <p className="context-note">选择左侧条目，查看请求快照中的原始内容。</p>}
                </div>
              </section>
              <section className="context-inspector-block" aria-label="上下文整理">
                <header className="context-inspector-head"><h3>上下文整理</h3></header>
                {contextPlan ? <>
                  <dl className="context-facts">
                    <div><dt>整理配置</dt><dd>{contextPlan.profileName} · revision {contextPlan.profileRevision}</dd></div>
                    {contextPlan.steps.length > 0
                      ? <div><dt>估算变化</dt><dd>{contextPlan.beforeTokens.toLocaleString()} → {contextPlan.afterTokens.toLocaleString()} tokens · 输入额度 {contextPlan.inputLimit.toLocaleString()}</dd></div>
                      : <div><dt>整理结果</dt><dd>未触发压缩 · 估算 {contextPlan.afterTokens.toLocaleString()} / {contextPlan.inputLimit.toLocaleString()} tokens</dd></div>}
                  </dl>
                  {contextPlan.steps.length > 0 && <Collapsible className="context-raw">
                    <CollapsibleTrigger>整理步骤 · {contextPlan.steps.length}</CollapsibleTrigger>
                    <CollapsibleContent keepMounted>
                      <ul className="context-steps">
                        {contextPlan.steps.map(step => <li key={step.stepId}>
                          {STEP_TITLES[step.kind]} · {REASONS[step.reason]} · {step.beforeTokens.toLocaleString()} → {step.afterTokens.toLocaleString()} tokens
                        </li>)}
                      </ul>
                    </CollapsibleContent>
                  </Collapsible>}
                </> : <p className="context-note">本次请求未触发上下文整理。</p>}
                {context.summary && <>
                  <h4 className="context-detail-subtitle">已采用摘要</h4>
                  <p className="context-note">{context.compactedAt ? new Date(context.compactedAt).toLocaleString('zh-CN', { hour12: false }) : '整理时间未记录'}</p>
                  <OutputBlock text={context.summary} />
                </>}
                {compactions.length > 0 && <>
                  <h4 className="context-detail-subtitle">摘要请求 · {compactions.length}</h4>
                  <div className="context-list">
                    {compactions.map(request => {
                      const reqPos = requests.indexOf(request) + 1;
                      const timeText = request.requestedAt
                        ? ` · ${new Date(request.requestedAt).toLocaleTimeString('zh-CN', { hour12: false })}`
                        : '';
                      const usageText = request.usage
                        ? ` · ${request.usage.promptTokens.toLocaleString()} tokens`
                        : ' · 已提交请求';
                      return <Item
                        key={request.key}
                        size="xs"
                        className="context-row"
                        render={<button type="button" />}
                        onClick={() => chooseRequest(request.key)}
                      >
                        <ItemMedia variant="icon"><Icon name="list" size="sm" /></ItemMedia>
                        <ItemContent>
                          <ItemTitle>#{reqPos} 摘要请求 · {requestState(request)}</ItemTitle>
                          <ItemDescription>任务 {turnNumber(request.turnId)}{timeText}{usageText}</ItemDescription>
                        </ItemContent>
                        <ItemActions><Icon name="chevron-right" size="xs" /></ItemActions>
                      </Item>;
                    })}
                  </div>
                </>}
                {compactions.some(request => !request.adopted) && (
                  <p className="context-note">摘要请求已提交不代表已应用，以整理事实为准。</p>
                )}
              </section>
            </div>
          </ScrollArea>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
    <div
      id="context-view-panel-raw"
      role="tabpanel"
      aria-labelledby="context-view-tab-raw"
      className="context-views"
      hidden={view !== 'raw'}
    >
      <ScrollArea className="context-scroll">
        <div className="context-raw-view">
          <header className="context-section-head">
            <h3>请求快照</h3>
            <span className="context-section-note">已提交的请求与返回事实，未做改写。</span>
          </header>
          <pre className="context-json context-raw-json">{raw}</pre>
        </div>
      </ScrollArea>
    </div>
  </div>;
}, (previous, next) => {
  // 隐藏时冻结已有展示树，保留滚动位置、分栏及局部交互状态，不消费后台新事实。
  // 再次显示时以最新事件引用补齐；初次隐藏由组件内可见性判断跳过投影。
  if (next.visible === false) return true;
  return previous.visible === next.visible
    && previous.events === next.events
    && previous.hasEarlier === next.hasEarlier;
});

/** 详情只投影选中条目；消息、工具与整理事实分开描述，不把请求快照改写成执行结果。 */
function describeSelection(
  selection: ContextSelection | null,
  message: RequestMessage | undefined,
  tool: RequestTool | undefined,
  context: ContextRequest,
): { title: string; body: ReactNode } | null {
  if (selection?.kind === 'message' && message) {
    return {
      title: `${ROLES[message.role]} · ${selection.index + 1}`,
      body: <>
        {message.toolName && <p className="context-note">{message.toolName}</p>}
        <OutputBlock text={message.content} />
        {!message.content && !message.toolCalls?.length && <p className="context-note">此条消息没有正文或工具调用。</p>}
        {Boolean(message.toolCalls?.length) && <section className="context-tool-calls" aria-label="工具调用声明">
          <h4 className="context-detail-subtitle">工具调用声明 · {message.toolCalls!.length}</h4>
          {message.toolCalls!.map(call => <ToolCallDetail key={call.id} call={call} />)}
        </section>}
      </>,
    };
  }
  if (selection?.kind === 'tool' && tool) {
    return {
      title: capabilityLabel(tool.target),
      body: <>
        <p className="context-note">{tool.description}</p>
        <code className="context-identity">{tool.name} · {tool.target.providerId} · {tool.target.contractId} · revision {tool.target.revision}</code>
        <Collapsible className="context-raw" defaultOpen>
          <CollapsibleTrigger>工具声明与参数 Schema</CollapsibleTrigger>
          <CollapsibleContent keepMounted>
            <pre>{JSON.stringify(tool, null, 2)}</pre>
          </CollapsibleContent>
        </Collapsible>
      </>,
    };
  }
  if (selection?.kind === 'preparations') {
    return {
      title: '推理前参考结果',
      body: <pre className="context-json">{JSON.stringify(context.preparations ?? [], null, 2)}</pre>,
    };
  }
  if (selection?.kind === 'declarations') {
    return {
      title: '准备能力声明',
      body: <pre className="context-json">{JSON.stringify(context.effect.preparations ?? [], null, 2)}</pre>,
    };
  }
  if (selection?.kind === 'projection') {
    return {
      title: '上下文整理事实',
      body: <pre className="context-json">{JSON.stringify({ projection: context.effect.contextProjection, contextPlan: context.contextPlan }, null, 2)}</pre>,
    };
  }
  return null;
}

function ToolCallDetail({ call }: { call: RequestToolCall }) {
  return <section className="context-tool-call">
    <header><Icon name="terminal" size="sm" /><strong>{call.name}</strong></header>
    <pre className="context-json">{JSON.stringify(call.input, null, 2)}</pre>
    <Collapsible className="context-raw">
      <CollapsibleTrigger>原始调用声明</CollapsibleTrigger>
      <CollapsibleContent keepMounted>
        <pre>{JSON.stringify(call, null, 2)}</pre>
      </CollapsibleContent>
    </Collapsible>
  </section>;
}
