import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@archer/ui';
import { ProgressParagraph } from './ProgressParagraph';
import { FinalAnswer } from '../ai-ui/conversation/Content';
import { ActivityGroup } from './ActivityGroup';
import {
  AgentTurn, Button, Dialog, InteractionRecord, Message, MessageHeader, Plan, PlanHistory,
  Reasoning, Spinner, Tool, Trace, TraceDescription, TurnSummary,
} from '@archer/ui';
import { taskErrorMessage } from '../../lib/task-error';
import { contextStatus } from '../../lib/context-status';
import { ContextCompactionStatus } from './ContextCompaction';
import { record } from '../../lib/operation';
import type { InferenceProgress, Snapshot } from '@archer/contracts';
/** 正式消息来自已提交事实，生成中的正文使用独立的临时预览。 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { ElapsedTime } from './ElapsedTime';
import { useEffectProgress } from '../../store/progress';

import { AppliedChange, OutputBlock } from './ToolOutput';
import { InspectChanges, TaskInsights } from './TaskInsights';
import { Icon } from '@archer/ui';
import { Markdown } from '../primitives/Markdown';
import { assistantText } from '../../lib/format';
import { buildItems, type TimelineEvent, type EffectEntry } from '../../lib/conversation';
import { commandResult, durationText, fileChange, operationDisplay, operationState, operationSummary } from '../../lib/operation';
import { planRecords, taskChanges, type PlanRecord } from '../../lib/task-insights';
import { activitySections, activityWindow, isHumanInteraction, turnPresentations, type TranscriptSection, type ActivityItem, type TurnPresentation } from '../../lib/transcript';
import { traceStatus, traceTone } from './trace-status';

const TimelineClock = createContext({ active: false, displayTime: undefined as number | undefined });

/** 仅按连续事实的 Turn 身份建立阅读组，不移动队列输入或重排事件。 */
function workspaceGroups(sections: readonly TranscriptSection[]) {
  const groups: { id: string; items: TranscriptSection[] }[] = [];
  for (const item of sections) {
    const id = ('turnId' in item && item.turnId) || `input-${item.seq}`;
    const last = groups.at(-1);
    if (last?.id === id) last.items.push(item);
    else groups.push({ id, items: [item] });
  }
  return groups;
}

/** 只读取已加载 Turn 的开始时间；历史窗口从中间开始时明确不补造时间。 */
function groupStartedAt(items: readonly TranscriptSection[]) {
  for (const item of items) if (item.kind === 'turn-start') return item.at;
  return undefined;
}

/** 组头只使用署名、品牌标记与已加载的开始时间，不重复消息头像或推测内容。 */
function AgentHeader({ startedAt }: { startedAt?: number }) {
  return (
    <MessageHeader
      icon={<span className="archer-mark" aria-hidden="true" />}
      name="Archer"
      time={startedAt === undefined ? undefined : new Date(startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    />
  );
}

/** 优先使用显式注入的测试进度；生产环境只按 effectId 订阅叶节点快照。 */
function useInferenceFrame(
  agentId: string | undefined,
  effectId: string | undefined,
  progress?: Record<string, Snapshot<InferenceProgress>>,
): Snapshot<InferenceProgress> | undefined {
  const live = useEffectProgress(progress ? undefined : agentId, effectId);
  return progress ? (effectId ? progress[effectId] : undefined) : live;
}

export function EventTimeline({
  events, active, agentId, progress, onInspectChanges, cancellingTurnId, executionPaused = false, pendingInteraction, compact = false, onInspectActivity, onInspectInvocation, displayTime,
}: {
  /** 固定预览可显式注入展示时钟，正式页面省略后按本机时间更新。 */
  displayTime?: number;
  onInspectInvocation?(key: string): void;
  compact?: boolean;
  onInspectActivity?(): void;
  pendingInteraction?: { turnId: string; effectId: string; content: ReactNode };
  cancellingTurnId?: string;
  executionPaused?: boolean;
  onInspectChanges?(turnId: string, path?: string): void;
  events: readonly TimelineEvent[];
  active: boolean;
  agentId?: string;
  progress?: Record<string, Snapshot<InferenceProgress>>;
}) {
  const items = useMemo(() => buildItems(events), [events]);
  const turns = useMemo(() => turnPresentations(items), [items]);
  // 在分组前剔除已被当前状态替代的通知，避免空分组继续占据轮次间距。
  const visibleItems = useMemo(() => items.filter(item => {
    if (item.kind !== 'notice') return true;
    if (item.text === 'Agent 已创建' || item.text.startsWith('执行配置已更新')) return false;
    if (item.text === '队列已暂停，恢复后可继续后续任务' || item.text === '队列已恢复') return false;
    return !(item.text === '已请求停止任务，等待执行确认'
      && item.turnId && turns.get(item.turnId)?.endedAt !== undefined);
  }), [items, turns]);
  const sections = useMemo(() => activitySections(visibleItems, pendingInteraction, compact), [visibleItems, pendingInteraction, compact]);
  const entriesByTurn = useMemo(() => {
    const grouped = new Map<string, EffectEntry[]>();
    for (const item of items) {
      if (item.kind !== 'effect') continue;
      const entries = grouped.get(item.turnId) ?? [];
      entries.push(item.entry);
      grouped.set(item.turnId, entries);
    }
    return grouped;
  }, [items]);
  const plans = useMemo(() => planRecords([...entriesByTurn.values()].flat()), [entriesByTurn]);
  const groups = useMemo(() => workspaceGroups(sections), [sections]);
  const current = [...items].reverse().find(item => item.kind === 'effect');
  const currentEntries = current?.kind === 'effect' ? entriesByTurn.get(current.turnId) ?? [] : [];
  const currentTurn = current?.kind === 'effect' ? turns.get(current.turnId) : undefined;
  const pendingLocated = pendingInteraction && items.some(item => item.kind === 'effect'
    && item.turnId === pendingInteraction.turnId && item.entry.effectId === pendingInteraction.effectId);
  // 时钟配置不含逐秒状态；只有耗时文字订阅时钟，历史树不随秒针更新。
  const clock = useMemo(() => ({ active, displayTime }), [active, displayTime]);
  if (!visibleItems.length && !pendingInteraction) return <div className="chat-empty"><Icon name="spark" size="lg" /><h2>{active ? '正在准备任务' : '工作区已就绪'}</h2><p>输入任务，开始这段对话。</p></div>;
  return <TimelineClock.Provider value={clock}><InspectChanges.Provider value={onInspectChanges}><div className="transcript">{groups.map((group, index) => {
    const startedAt = groupStartedAt(group.items);
    // 停止回执是系统状态；仅包含边界和通知的分组不冒充助手答复。
    const onlyStopped = group.items.some(item => item.kind === 'turn-end' && item.fact.type === 'turn.cancelled')
      && group.items.every(item => item.kind === 'turn-end' || item.kind === 'turn-start' || item.kind === 'notice');
    const hasAgentWork = !onlyStopped && group.items.some(item => item.kind !== 'user' && item.kind !== 'notice');
    return (
      <AgentTurn
        className={`workspace-turn-group${onlyStopped ? ' workspace-stop-group' : ''}`}
        aria-label={hasAgentWork ? `工作记录 ${index + 1}` : '用户输入'}
        key={`${group.id}-${group.items[0]?.seq}`}
      >
        {hasAgentWork && (
          <div className="workspace-turn-heading">
            <AgentHeader startedAt={startedAt} />
            {/* 累计摘要只投影到署名旁，正文和人工交互仍保留原发生顺序。 */}
            {compact && group.items.some(item => item.kind === 'activity') && (
              <ActivityFlow compact onInspectActivity={onInspectActivity}
                items={sections.flatMap(section => section.kind === 'activity' && section.turnId === group.id ? section.items : [])}
                turn={turns.get(group.id)} />
            )}
          </div>
        )}
        {group.items.map(item => {
    if (item.kind === 'activity') {
      // 累计摘要只出现一次；活动仍在原发生处呈现，不能搬到人工交互之前。
      return <div key={item.seq}>
        {compact ? <ConversationActivity turnId={item.turnId} onInspectInvocation={onInspectInvocation} items={item.items} turn={turns.get(item.turnId)} agentId={agentId} progress={progress} />
          : <ActivityFlow items={item.items} turn={turns.get(item.turnId)} agentId={agentId} progress={progress} />}
      </div>;
    }
    if (item.kind === 'user') return <Message role="user" key={item.seq}
      header={item.label !== '发送' ? <span className="input-kind">{item.label === '引导' ? '补充当前任务' : '排队下一任务'}</span> : undefined}
      actions={<><time dateTime={new Date(item.at).toISOString()}>{new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><CopyMessageButton text={item.text} label="消息" /></>}>
      {item.text}
      {item.images?.map((image, index) => <img key={index} src={`data:${image.mediaType};base64,${image.data}`} alt={`用户图片 ${index + 1}`} style={{ maxWidth: '100%', maxHeight: 320, objectFit: 'contain' }} />)}
    </Message>;
    if (item.kind === 'notice') {
      const ended = item.turnId && turns.get(item.turnId)?.endedAt !== undefined;
      if (item.text.startsWith('等待中') && (ended || pendingInteraction?.turnId === item.turnId)) return null;
      return <p key={item.seq} className={`conversation-notice ${item.tone}`}>{item.text}</p>;
    }
    const turn = turns.get(item.turnId);
    if (item.kind === 'turn-start') return compact ? <span id={`turn-${item.turnId}`} key={item.seq} /> : <div className="turn-boundary" id={`turn-${item.turnId}`} key={item.seq}>
      <span>任务 {item.turnId.split(':t').at(-1)}</span>
      {item.note && <span>{item.note}</span>}
    </div>;
    if (item.kind === 'turn-end') {
      const failed = item.fact.type === 'turn.failed';
      const errorMessage = item.fact.type === 'turn.failed' ? item.fact.data.error.message : '';
      const cancelReason = item.fact.type === 'turn.cancelled' ? item.fact.data.reason : undefined;
      const stats = turn && <TurnStats outcome={item.fact.type === 'turn.completed' ? 'completed' : failed ? 'failed' : 'cancelled'} turn={turn} entries={entriesByTurn.get(item.turnId) ?? []} />;
      const answer = turn?.answer ?? '任务已完成。';
      // 完成展示最终正文；失败与停止只保留执行回执及必要原因，避免重复状态块。
      return <div key={item.seq} className="turn-outcome">
        {item.fact.type === 'turn.completed' ? <FinalAnswer text={answer} results={stats} /> : (
          <div>
            {stats}
            {failed && <p className="turn-outcome-reason">{taskErrorMessage(errorMessage)}</p>}
            {!failed && cancelReason && cancelReason !== 'aborted' && cancelReason !== 'user'
              && <p className="turn-outcome-reason">停止原因：{cancelReason}</p>}
          </div>
        )}
      </div>;
    }
    const entry = item.entry;
    // 当前人工操作优先于效果类型展示，推理结果未知时的对账表单也必须可见。
    const pending = pendingInteraction?.turnId === item.turnId && pendingInteraction.effectId === entry.effectId;
    if (pending) return <div className="timeline-interaction" key={item.seq}>{pendingInteraction.content}</div>;
    if (entry.effectType === 'INFER') return <div className="timeline-operation" key={item.seq}>
      <ProcessNote entry={entry} agentId={agentId} progress={progress} final={turn?.finalEffectId === entry.effectId} />
      <OperationCard entry={entry} />
    </div>;
    const plan = plans.get(entry.effectId);
    // 计划声明不是执行段落：只保留一行轻量事件，完整步骤点击后阅读，当前计划仍在输入区。
    if (plan) return <PlanEventRow key={item.seq} record={plan} ended={turn?.endedAt !== undefined} />;
    if (isHumanInteraction(entry)) return <HumanRecord key={item.seq} entry={entry} />;
    return <div className="timeline-operation" key={item.seq}>
      <OperationCard entry={entry} />
    </div>;
  })}
        {/* 阶段提示属于当前工作轮，避免落在整轮外侧叠加底部留白。 */}
        {index === groups.length - 1 && active && currentTurn?.endedAt === undefined && !pendingInteraction && (
          <ExecutionStatus entries={currentEntries} agentId={agentId} progress={progress}
            cancelling={Boolean(cancellingTurnId)} paused={executionPaused} />
        )}
      </AgentTurn>
    );
  })}
    {pendingInteraction && !pendingLocated && <div className="timeline-interaction">
      <p className="execution-muted">当前询问的起始记录尚未加载。</p>
      {pendingInteraction.content}
    </div>}

  </div></InspectChanges.Provider></TimelineClock.Provider>;
}

/** 未提交的在途推理片段单独订阅自身 effectId，避免正文流式帧触发已提交段落与工具组重渲染。 */
function StreamingWorkSegment({ entry, calls, agentId, progress, turnId, onInspectInvocation }: {
  entry: EffectEntry;
  calls: EffectEntry[];
  agentId?: string;
  progress?: Record<string, Snapshot<InferenceProgress>>;
  turnId: string;
  onInspectInvocation?(key: string): void;
}) {
  const frame = useInferenceFrame(agentId, entry.effectId, progress);
  const content = inferenceContent(entry, frame);
  if (!content.text && !calls.length) return null;
  const streaming = !content.result && frame?.phase === 'generating';
  const preview = content.result || !frame ? undefined : previewState(frame);
  return (
    <section className={`conversation-work-segment${content.text ? ' has-prose' : ''}`}>
      {content.text && <ProgressParagraph text={content.text} preview={preview} streaming={streaming} effectId={entry.effectId} />}
      {calls.length > 0 && <ActivityGroup entries={calls} onInspect={onInspectInvocation ? effectId => onInspectInvocation(`${turnId}/${effectId}`) : undefined} />}
    </section>
  );
}

/** 公开文本划定阅读段落；推理不充当反馈，也不跨越段落聚合工具。 */
function ConversationActivity({ items, turn, agentId, progress, onInspectInvocation, turnId }: {
  turnId: string;
  onInspectInvocation?(key: string): void;
  items: readonly ActivityItem[];
  turn?: TurnPresentation;
  agentId?: string;
  progress?: Record<string, Snapshot<InferenceProgress>>;
}) {
  type ActivityBlock =
    | { kind: 'static'; key: string; text?: string; calls: EffectEntry[] }
    | { kind: 'open-infer'; key: string; entry: EffectEntry; calls: EffectEntry[] };
  const blocks: ActivityBlock[] = [];
  for (const item of items) {
    if (item.kind !== 'effect') continue;
    if (item.entry.effectType === 'INFER') {
      if (item.entry.effectId === turn?.finalEffectId) continue;
      if (!item.entry.end) {
        blocks.push({ kind: 'open-infer', key: item.entry.effectId, entry: item.entry, calls: [] });
        continue;
      }
      const content = inferenceContent(item.entry);
      if (content.text) {
        blocks.push({ kind: 'static', key: item.entry.effectId, text: content.text, calls: [] });
      }
      continue;
    }
    let block = blocks.at(-1);
    if (!block) {
      block = { kind: 'static', key: item.entry.effectId, calls: [] };
      blocks.push(block);
    }
    block.calls.push(item.entry);
  }
  return <>{blocks.map(block => block.kind === 'open-infer'
    ? <StreamingWorkSegment key={block.key} entry={block.entry} calls={block.calls} agentId={agentId} progress={progress} turnId={turnId} onInspectInvocation={onInspectInvocation} />
    : <section className={`conversation-work-segment${block.text ? ' has-prose' : ''}`} key={block.key}>
      {block.text && <ProgressParagraph text={block.text} effectId={block.key} />}
      {block.calls.length > 0 && <ActivityGroup entries={block.calls} onInspect={onInspectInvocation ? effectId => onInspectInvocation(`${turnId}/${effectId}`) : undefined} />}
    </section>)}</>;
}

/**
 * 完成调用按原事件顺序折叠，未结束、失败和未知调用保持可见。
 * 没有公开反馈时只显示中性工具组，不根据命令或计划推断阶段名称。
 */
/** 平铺活动只有一层阅读结构；早期/已结束记录按需展开，重要节点由外层保持原位。 */
function ActivityFlow({ items, turn, agentId, progress, compact, onInspectActivity }: {
  compact?: boolean;
  onInspectActivity?(): void;
  items: readonly ActivityItem[];
  turn?: TurnPresentation;
  agentId?: string;
  progress?: Record<string, Snapshot<InferenceProgress>>;
}) {
  // 简版按原顺序展示真实调用；展开留在对话，只有独立入口进入完整调试视图。
  if (compact) {
    const calls = items.flatMap(item => item.kind === 'effect' && item.entry.effectType !== 'INFER' ? [item.entry] : []);
    // 没有工具调用的公开反馈不生成零调用摘要，完整事实仍可从活动视图读取。
    if (!calls.length) return null;
    const attention = calls.filter(entry => ['error', 'warning'].includes(operationState(entry).tone)).length;
    // 状态只说明此片段的调用结果；进行中的 Turn 在调用间隙保持「执行中」，避免摘要文案长短反复切换引发折行跳动。
    const running = calls.some(entry => !entry.end);
    const tone = attention > 0 ? 'warning' : running ? 'running' : 'ok';
    const label = attention > 0
      ? `${attention} 项需关注`
      : running || turn?.endedAt === undefined
        ? '执行中'
        : `此前 ${calls.length} 次调用已完成`;
    return <ExecutionSummary calls={calls} turn={turn} tone={tone} label={label} onInspectActivity={onInspectActivity} />;
  }
  const ended = turn?.endedAt !== undefined;
  const { earlier, recent } = activityWindow(items, ended);
  const isVisible = (item: ActivityItem) => {
    if (item.kind === 'notice' || item.entry.effectType !== 'INFER') return true;
    if (!item.entry.end) return item.entry.effectId !== turn?.finalEffectId;
    const content = inferenceContent(item.entry, progress?.[item.entry.effectId]);
    return !!content.reasoning || item.entry.effectId !== turn?.finalEffectId && !!content.text;
  };
  const history = earlier.filter(isVisible);
  const historyCalls = history.filter(item => item.kind === 'effect' && item.entry.effectType !== 'INFER').length;
  const historyInferences = history.filter(item => item.kind === 'effect' && item.entry.effectType === 'INFER').length;
  if (!history.length && !recent.some(isVisible)) return null;
  const renderItems = (list: readonly ActivityItem[]) => <>
    {list.map(item => {
      if (item.kind === 'notice') return <p key={item.seq} className="activity-notice">{item.text}</p>;
      return item.entry.effectType === 'INFER'
        ? <InferenceActivity key={item.seq} entry={item.entry} agentId={agentId} progress={progress}
            final={item.entry.effectId === turn?.finalEffectId} />
        : <OperationCard key={item.seq} entry={item.entry} />;
    })}
  </>;
  return <div className="activity-flow">
    {history.length > 0 && <Collapsible className="activity-history">
      <CollapsibleTrigger>
        <Icon name="chevron-right" size="xs" />
        <span>{ended ? '过程记录' : '较早活动'}</span>
        {historyCalls > 0 ? <small>{historyCalls} 项调用</small>
          : historyInferences > 0 ? <small>{historyInferences} 次推理</small> : null}
        {turn?.startedAt === undefined && <small>仅已加载记录</small>}
      </CollapsibleTrigger>
      <CollapsibleContent keepMounted>
        <div className="activity-rows">{renderItems(history)}</div>
      </CollapsibleContent>
    </Collapsible>}
    <div className="activity-rows">{renderItems(recent)}</div>
  </div>;
}

/**
 * 单轮累计摘要只保留一行入口，展开后按真实顺序回到全部调用。
 * 计划声明不进入摘要或段落；它只由输入区入口展示，避免阶段名称冒充执行事实。
 */
function ExecutionSummary({ calls, turn, tone, label, onInspectActivity }: {
  calls: readonly EffectEntry[];
  turn?: TurnPresentation;
  tone: 'warning' | 'running' | 'ok';
  label: string;
  onInspectActivity?(): void;
}) {
  const changedFiles = new Set(taskChanges(calls).map(change => change.path)).size;
  return <TurnSummary
    ariaLabel="本轮执行摘要"
    label={<><Icon name="clock" size="sm" />{label}</>}
    tone={tone === 'warning' ? 'warning' : tone === 'running' ? 'running' : 'muted'}
    calls={calls.length}
    duration={turn?.startedAt !== undefined ? <TimelineDuration startedAt={turn.startedAt} endedAt={turn.endedAt} /> : undefined}
    meta={changedFiles > 0 ? `${changedFiles} 个文件修改` : undefined}
    actions={onInspectActivity && <Button variant="ghost" onClick={onInspectActivity}>查看全部活动<Icon name="chevron-right" size="xs" /></Button>}
  />;
}

/** 推理与工具按所属效果原位交错；思考、公开进度各用统一 Trace 行。 */
function InferenceActivity({ entry, agentId, progress, final = false }: {
  entry: EffectEntry;
  agentId?: string;
  progress?: Record<string, Snapshot<InferenceProgress>>;
  final?: boolean;
}) {
  const frame = useInferenceFrame(agentId, entry.end ? undefined : entry.effectId, progress);
  const content = inferenceContent(entry, frame);
  const text = final ? undefined : content.text;
  if (!text && !content.reasoning) return null;
  const preview = (text || content.reasoning || '').replace(/\s+/g, ' ').trim();
  return <>
    {content.reasoning && <Reasoning text={content.reasoning} running={!content.result} />}
    {text && <Tool title="公开进度" description={preview} status={!content.result ? 'running' : undefined}
      icon={<Icon name="spark" size="sm" />}>
      <Markdown text={text} />
      {!content.result && <p className="execution-muted">{frame?.phase === 'interrupted' ? '推理已中断。' : ''}临时内容，尚未作为正式回复提交。</p>}
    </Tool>}
  </>;
}

function inferenceContent(entry: EffectEntry, frame?: Snapshot<InferenceProgress>) {
  const result = entry.end?.type === 'effect.completed' && entry.end.data.effectType === 'INFER'
    ? entry.end.data.result : undefined;
  // 临时流只在结果尚未提交时显示，不能把中断预览标作正式事实。
  return {
    text: result ? assistantText(result.content) : frame?.content,
    reasoning: result?.reasoning || (!result ? frame?.reasoning : undefined),
    result,
  };
}

/** 临时流的阶段文案区分仍在生成与已中断，避免把中断预览读成正在进行的答复。 */
function previewState(frame: Snapshot<InferenceProgress>) {
  if (frame.phase === 'interrupted') return '已中断 · 未提交';
  if (frame.phase === 'settled') return '待提交';
  return '生成中 · 未提交';
}

function CopyMessageButton({ text, label }: { text: string; label: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  return <Button variant="ghost" size="sm" className="message-copy" aria-label={status === 'copied' ? `${label}已复制` : status === 'error' ? '复制失败，点击重试' : `复制${label}`} title={status === 'copied' ? '已复制' : status === 'error' ? '复制失败，点击重试' : `复制${label}`} onClick={() => {
    void navigator.clipboard.writeText(text).then(() => setStatus('copied')).catch(() => setStatus('error'));
  }}><Icon name={status === 'copied' ? 'check' : status === 'error' ? 'alert' : 'copy'} size="sm" /><span role="status">{status === 'copied' ? '已复制' : status === 'error' ? '复制失败' : ''}</span></Button>;
}

/** 答复底部优先提供操作入口；模型与累计用量按需查看，不挤占正文阅读。 */
function TurnStats({ turn, entries, outcome }: {
  turn: TurnPresentation;
  entries: EffectEntry[];
  outcome: 'completed' | 'failed' | 'cancelled';
}) {
  const attention = entries.filter(entry => entry.effectType !== 'INFER'
    && ['error', 'warning'].includes(operationState(entry).tone));
  // 文件属于任务产出；状态与运行指标统一放在分割线后的回执区。
  return (
    <>
      <TaskInsights entries={entries} complete={turn.startedAt !== undefined} />
      <div className="turn-execution-receipt">
        <TurnSummary
          status={outcome}
          calls={turn.operations}
          duration={turn.startedAt !== undefined && turn.endedAt !== undefined ? durationText(turn.endedAt - turn.startedAt) : undefined}
          attention={attention.length > 0 && <span className="turn-attention"
            title="调用存在失败或未知结果；不代表整轮任务失败">
            <Icon name="alert" size="xs" />{attention.length} 项需关注
          </span>}
        >
          <InteractionRecord
            title="执行详情"
            icon={<Icon name="info" size="sm" />}
            meta={`${turn.inferenceSteps} 次推理`}
          >
            <div className="turn-execution-summary">
              {turn.startedAt !== undefined && turn.endedAt !== undefined && <span>
                <Icon name="clock" size="xs" />{durationText(turn.endedAt - turn.startedAt)}
              </span>}
              <ExecutionRecords entries={entries} complete={turn.startedAt !== undefined} />
            </div>
            <div className="turn-fact-groups">
              <section className="turn-fact-group">
                <h4>执行</h4>
                <dl>
                  {turn.endedAt !== undefined && <div><dt>结束时间</dt><dd>{new Date(turn.endedAt).toLocaleString()}</dd></div>}
                  <div><dt>推理次数</dt><dd>{turn.inferenceSteps} 次</dd></div>
                  {turn.models.length > 0 && <div><dt>模型</dt><dd><code className="turn-fact-model">{turn.models.join(', ')}</code></dd></div>}
                </dl>
              </section>
              <section className="turn-fact-group">
                <h4>用量</h4>
                {turn.hasUsage ? <dl>
                  <div><dt>{turn.usageIncomplete ? '已知累计用量' : '累计用量'}</dt><dd>
                    {(turn.usage.promptTokens + turn.usage.completionTokens).toLocaleString()} tokens
                    （输入 {turn.usage.promptTokens.toLocaleString()} / 输出 {turn.usage.completionTokens.toLocaleString()}）
                  </dd></div>
                  <div><dt>缓存读取 / 写入</dt><dd>{turn.usage.cacheReadTokens?.toLocaleString() ?? '未知'} / {turn.usage.cacheWriteTokens?.toLocaleString() ?? '未知'}</dd></div>
                  <div><dt>最近一次输入</dt><dd>{turn.latestInputTokens?.toLocaleString() ?? '未知'}</dd></div>
                </dl> : <p className="turn-fact-empty">未返回用量</p>}
              </section>
            </div>
            {turn.hasUsage && <p className="turn-detail-note">
              {turn.usageIncomplete && '部分推理未返回用量，实际总量未知。'}
              缓存属于输入，不重复计入总量；累计用量不代表当前上下文占用或费用。
            </p>}
          </InteractionRecord>
        </TurnSummary>
      </div>
    </>
  );
}

/** 公开过程正文与思考分开呈现，内部思考不能替代模型对用户的进度说明。 */
function ProcessNote({ entry, agentId, progress, final = false }: {
  entry: EffectEntry;
  agentId?: string;
  progress?: Record<string, Snapshot<InferenceProgress>>;
  final?: boolean;
}) {
  const frame = useInferenceFrame(agentId, entry.end ? undefined : entry.effectId, progress);
  const { result, reasoning, text: content } = inferenceContent(entry, frame);
  const text = final ? '' : content;
  if (!text && !reasoning) return null;
  return <div className="process-message">
    {reasoning && <Reasoning text={reasoning} running={!result && frame?.phase === 'generating'} />}
    {text && <div className="process-commentary"><Markdown text={text} streaming={!result && frame?.phase === 'generating'} /></div>}
    {frame?.phase === 'interrupted' && !result && <p className="execution-muted">中断前的临时内容，未作为正式回复提交。</p>}
  </div>;
}

/** 计划事件只占一行：版本与步骤变化在点击后阅读，不把步骤列表铺进执行正文。 */
function PlanEventRow({ record: { plan: declaration, previous, kind, versions }, ended = false }: { record: PlanRecord; ended?: boolean }) {
  const plan = kind === 'created' || kind === 'snapshot' ? versions.at(-1)! : declaration;
  if (kind === 'progress') return null;
  const completed = plan.steps.filter(step => step.status === 'completed').length;
  const complete = completed === plan.steps.length;
  return (
    <Trace density="compact" aria-label="计划事件">
      <Plan
        title={`${ended && !complete ? '计划未完成 · 执行已结束' : complete && kind !== 'revised' ? '计划已完成' : kind === 'created' ? '已创建计划' : kind === 'snapshot' ? '已加载计划声明' : '已调整计划'} · ${declaration.title}`}
        icon={<Icon name={complete ? 'check' : 'list'} size="sm" />}
        defaultOpen={!complete}
        executionStopped={ended}
        showProgress={false}
        showStepStatus={false}
        steps={plan.steps.map((step, index) => ({
          id: `${index}`,
          text: step.text,
          status: step.status === 'in_progress' ? 'running' : step.status,
        }))}
      >
        {kind === 'snapshot' && <p>创建及更早的声明尚未加载。</p>}
        {plan.explanation && <p className="plan-explanation">{plan.explanation}</p>}
        {kind === 'created' && versions.length > 1 && <PlanHistory versions={versions.map(version => ({
          revision: version.revision,
          title: version.title,
          steps: version.steps.map((step, index) => ({
            id: `${index}`,
            text: step.text,
            status: step.status === 'in_progress' ? 'running' : step.status,
          })),
        }))} />}
        {kind === 'revised' && (previous ? <PlanHistory versions={[{
          revision: previous.revision,
          title: previous.title,
          steps: previous.steps.map((step, index) => ({
            id: `${index}`,
            text: step.text,
            status: step.status === 'in_progress' ? 'running' : step.status,
          })),
        }]} /> : <p>前一版声明尚未加载。</p>)}
      </Plan>
    </Trace>
  );
}

/** 已回答与已授权各自取已提交事实；结束或取消不补造人类答案。 */
function HumanRecord({ entry, command = false }: { entry: EffectEntry; command?: boolean }) {
  const effect = entry.effect;
  const input = effect?.type === 'CALL' ? record(effect.input) : {};
  const question = typeof input.reason === 'string' ? input.reason : entry.humanRequest?.reason;
  const end = entry.end;
  const result = end?.type === 'effect.completed' && end.data.effectType === 'CALL' && !command
    ? record(end.data.result.value)
    : undefined;
  const answered = result && typeof result.approved === 'boolean';
  const response = result && typeof result.response === 'string' ? result.response : '';
  const label = command ? entry.humanRequest?.resumed ? '已授权本次命令' : '授权请求已结束'
    : answered ? result.approved ? '已回答' : '已拒绝回答'
    : end ? '询问已结束 · 未记录回答' : entry.humanRequest?.resumed ? '回答已提交，正在同步记录' : '等待回答';
  return <InteractionRecord
    title={label}
    icon={<Icon name={command ? 'shield' : answered ? 'check' : 'info'} size="sm" />}
    /* 回答收成一行；没有回答时回退显示原问题，不补造人类答案。 */
    meta={response ? `：${response}` : question}
  >
    <div className="human-record-body">
      {question && <p>{question}</p>}
      {command && typeof input.command === 'string' && <pre><code>{input.command}</code></pre>}
      {response && <p className="human-response">{response}</p>}
      {end?.type === 'effect.cancelled' && <p>{end.data.reason}</p>}
    </div>
  </InteractionRecord>;
}

/** 整条执行流只有一个当前状态，等待卡片已表达暂停时不重复显示。 */
function ExecutionStatus({ entries, agentId, progress, cancelling, paused }: {
  entries: EffectEntry[];
  agentId?: string;
  progress?: Record<string, Snapshot<InferenceProgress>>;
  cancelling: boolean;
  paused: boolean;
}) {
  const current = [...entries].reverse().find(entry => !entry.abandonedReason && (!entry.end || entry.end.type === 'effect.unknown'));
  const state = current ? operationState(current) : undefined;
  const frame = useInferenceFrame(agentId, current?.effectType === 'INFER' ? current.effectId : undefined, progress);
  const contextActivity = current?.effectType === 'INFER' ? contextStatus(current) : undefined;
  if (contextActivity && current && frame?.phase !== 'interrupted') {
    return <ContextCompactionStatus entry={current} cancelling={cancelling} paused={paused} />;
  }
  // 已收到正文时由原位流式预览承担反馈，不重复放一条普通等待状态。
  if (!cancelling && !paused && frame?.phase === 'generating' && frame.content
    && state?.tone !== 'warning' && state?.tone !== 'error') return null;
  const stage = cancelling ? '正在等待停止确认…'
    : paused ? '执行已暂停，等待处理'
    : state?.tone === 'warning' || state?.tone === 'error' ? state.label
    : frame?.phase === 'interrupted' ? '推理已中断，等待确认'
    : current?.effectType === 'INFER' ? frame?.content ? '正在生成回复' : frame?.reasoning ? '正在思考…' : '等待模型响应…'
    : current ? `正在${operationSummary(current).title}` : '正在处理任务';
  // 当前阶段属于活动强调；警告与错误仍由独立语义色表达，避免把等待确认误画成普通进度。
  const tone = state?.tone === 'warning' ? 'is-warning' : state?.tone === 'error' ? 'is-error' : 'is-active';
  return <div className={`execution-stage-footer ${tone}`} role="status">
    {tone === 'is-active' && !paused && !cancelling && frame?.phase !== 'interrupted'
      ? <Spinner size="xs" />
      : <Icon name={tone === 'is-active' ? 'spark' : 'alert'} size="sm" />}
    <span>{stage}</span>
  </div>;
}

function ExecutionRecords({ entries, complete }: { entries: EffectEntry[]; complete: boolean }) {
  const [open, setOpen] = useState(false);
  const inspectChanges = useContext(InspectChanges);
  const operations = entries.filter(entry => entry.effectType !== 'INFER');
  if (!operations.length) return null;
  const attention = operations.filter(entry => ['error', 'warning'].includes(operationState(entry).tone)).length;
  return <>
    <Button variant="link" size="xs" className="execution-records-trigger" onClick={() => setOpen(true)}>
      <Icon name="terminal" size="xs" /><span>{operations.length} 项工具调用</span>
      {attention > 0 && <span className="process-attention">· {attention} 项需关注</span>}
    </Button>
    <Dialog open={open} onOpenChange={setOpen} title="工具调用记录"
      description={`${operations.length} 项调用${attention > 0 ? ` · ${attention} 项需关注` : ''}`}
      size="large" className="execution-history-dialog"
      actions={<Button variant="secondary" onClick={() => setOpen(false)}>关闭</Button>}>
      {open && <div className="execution-history-shell">
        <div className="live-execution-rows" tabIndex={0} aria-label="历史执行列表，可滚动查看">
          {entries.map(entry => entry.effectType === 'INFER'
            ? <ProcessNote key={entry.effectId} entry={entry} />
            : <OperationCard key={entry.effectId} entry={entry} />)}
        </div>
        <InspectChanges.Provider value={inspectChanges ? (turnId, path) => {
          setOpen(false);
          inspectChanges(turnId, path);
        } : undefined}>
          <TaskInsights entries={entries} complete={complete} />
        </InspectChanges.Provider>
      </div>}
    </Dialog>
  </>;
}

/** 工具行与其他执行 Trace 同构；参数、结果与原始请求就地展开，不另设详情页。 */
function OperationCard({ entry }: { entry: EffectEntry }) {
  const display = operationDisplay(entry);
  const status = operationState(entry);
  return <Tool
    title={display.title}
    description={display.primary}
    status={traceStatus(status.tone)}
    icon={status.tone === 'running' ? undefined : <Icon name={display.icon} size="sm" />}
    meta={<>
      {entry.humanRequest?.resumed && <span className="operation-authorization"
        title="已授权本次命令；不代表执行成功" aria-label="已授权本次命令"><Icon name="shield" size="xs" /></span>}
      {status.tone !== 'ok' && <TraceDescription data-tone={traceTone(status.tone)}>{status.label}</TraceDescription>}
    </>}
  >
    <OperationFacts entry={entry} />
    {entry.humanRequest && <HumanRecord entry={entry} command />}
    <OutputBlock text={display.target} />
    {display.detail && <p className="execution-muted">{display.detail}</p>}
    <OperationResult entry={entry} />
    <Collapsible className="execution-raw">
      <CollapsibleTrigger>原始请求</CollapsibleTrigger>
      <CollapsibleContent keepMounted>
        <OutputBlock text={JSON.stringify(entry.effect, null, 2)} />
      </CollapsibleContent>
    </Collapsible>
  </Tool>;
}

/** 耗时与重试属于单次操作详情，成功调用不再逐行堆叠勾选和毫秒数字。 */
function OperationFacts({ entry }: { entry: EffectEntry }) {
  const finishedAt = entry.end && 'finishedAt' in entry.end.data ? entry.end.data.finishedAt : undefined;
  const duration = entry.end && 'durationMs' in entry.end.data ? entry.end.data.durationMs : undefined;
  return <p className="execution-muted">
    {operationState(entry).label}
    {(duration !== undefined || entry.startedAt !== undefined && (finishedAt !== undefined || !entry.end)) && <>
      {' · '}<TimelineDuration startedAt={entry.startedAt} endedAt={finishedAt} durationMs={duration} />
    </>}
    {entry.attempt > 1 && ` · 第 ${entry.attempt} 次尝试`}
  </p>;
}

function OperationResult({ entry }: { entry: EffectEntry }) {
  const end = entry.end;
  if (!end) return <p className="execution-muted">{entry.suspendedReason ? '请在下方回答后继续。' : '正在等待能力返回结果。'}</p>;
  if (end.type !== 'effect.completed') return null;
  const data = end.data;
  if (data.effectType === 'CALL') {
    if (entry.effect?.type === 'CALL' && entry.effect.interaction === 'human') {
      const reply = record(data.result.value);
      return <p>{reply.approved ? '已回答' : '已拒绝回答'}{typeof reply.response === 'string' && reply.response ? ` · ${reply.response}` : ''}</p>;
    }
    const command = commandResult(entry);
    if (command) return <div className="terminal-result">
      <div className="terminal-caption"><code>{command.cwd}</code><span>退出码 {command.exitCode}</span></div>
      <OutputBlock text={`$ ${command.command}`} />
      {command.stdout && <OutputBlock text={command.stdout} />}
      {command.stderr && <div className="terminal-stderr"><small>标准错误</small><OutputBlock text={command.stderr} /></div>}
      {!command.stdout && !command.stderr && <p className="execution-muted">没有输出。</p>}
    </div>;
    const change = fileChange(entry);
    if (change) return <AppliedChange before={change.before} after={change.after} path={change.path} />;
    if (entry.effect?.type === 'CALL' && entry.effect.target.capabilityId === 'delegate') {
      const delegated = record(data.result.value);
      if (typeof delegated.output === 'string' && delegated.output) {
        return <OutputBlock text={delegated.output} />;
      }
    }
    return <OutputBlock text={String(record(data.result.value).output ?? JSON.stringify(data.result.value))} />;
  }
  if (data.effectType === 'CALL_BATCH') {
    const calls = entry.effect?.type === 'CALL_BATCH' ? entry.effect.calls : [];
    return (
      <div className="execution-batch-results">
        {data.result.results.map((item, index) => {
          const call = calls[index];
          const input = call ? record(call.input) : {};
          const label = typeof input.path === 'string'
            ? input.path
            : typeof input.pattern === 'string'
              ? input.pattern
              : typeof input.task === 'string'
                ? input.task
                : call?.toolName ?? `调用 #${index + 1}`;
          if (item.status === 'failed') {
            return (
              <p key={call?.toolCallId ?? index} className="execution-muted">
                {`${label} · 失败：${item.error.message}`}
              </p>
            );
          }
          const detail = item.result.isError ? '未成功' : '已完成';
          return (
            <p key={call?.toolCallId ?? index} className="execution-muted">
              {`${label} · ${detail}`}
            </p>
          );
        })}
      </div>
    );
  }
  return <OutputBlock text={JSON.stringify(data.result, null, 2)} />;
}

/** 时间只影响耗时文本；结束事实或显式预览时间均不启动定时器。 */
function TimelineDuration(props: { startedAt?: number; endedAt?: number; durationMs?: number; displayTime?: number }) {
  const clock = useContext(TimelineClock);
  return <ElapsedTime {...props} running={clock.active} displayTime={props.displayTime ?? clock.displayTime} />;
}
