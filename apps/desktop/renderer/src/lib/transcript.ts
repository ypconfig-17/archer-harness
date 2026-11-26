/** Turn 归属来自事实中的身份，不因排队消息或通知插入而改变。 */
import type { TokenUsage } from '@archer/contracts';
import { operationState } from './operation';
import { declaredPlan, planRecords } from './task-insights';
import { assistantText } from './format';
import type { EffectEntry, TimelineItem } from './conversation';

export interface TurnPresentation {
  startedAt?: number;
  endedAt?: number;
  operations: number;
  inferenceSteps: number;
  usage: TokenUsage;
  hasUsage: boolean;
  usageIncomplete: boolean;
  latestInputTokens?: number;
  models: string[];
  answer?: string;
  finalEffectId?: string;
}
export function turnPresentations(items: readonly TimelineItem[]): Map<string, TurnPresentation> {
  const turns = new Map<string, TurnPresentation>();
  const lastInference = new Map<string, EffectEntry>();
  for (const item of items) {
    if (!('turnId' in item) || !item.turnId) continue;
    let turn = turns.get(item.turnId);
    if (!turn) {
      turn = { operations: 0, inferenceSteps: 0, usage: { promptTokens: 0, completionTokens: 0 }, hasUsage: false, usageIncomplete: false, models: [] };
      turns.set(item.turnId, turn);
    }
    if (item.kind === 'turn-start') turn.startedAt = item.at;
    if (item.kind === 'effect') {
      const entry = item.entry;
      if (entry.effectType !== 'INFER') { turn.operations++; continue; }
      lastInference.set(item.turnId, entry);
      turn.inferenceSteps++;
      if (entry.effect?.type === 'INFER') {
        const config = entry.effect.config;
        const route = [config?.provider, config?.model].filter(Boolean).join('/');
        if (route && !turn.models.includes(route)) turn.models.push(route);
      }
      for (const request of entry.inferenceRequests ?? []) {
        const usage = request.result?.usage;
        if (!usage) turn.usageIncomplete = true;
        if (request.purpose === 'agent') turn.latestInputTokens = usage?.promptTokens;
        for (const field of ['cacheReadTokens', 'cacheWriteTokens'] as const) {
          const value = usage?.[field];
          if (!turn.hasUsage && !turn.usageIncomplete) turn.usage[field] = value;
          else if (turn.usage[field] !== undefined && value !== undefined) turn.usage[field] += value;
          else delete turn.usage[field];
        }
        if (usage) {
          turn.hasUsage = true;
          turn.usage.promptTokens += usage.promptTokens;
          turn.usage.completionTokens += usage.completionTokens;
        }
      }
    }
    if (item.kind === 'turn-end') {
      turn.endedAt = item.fact.data.completedAt;
      if (item.fact.type === 'turn.completed') {
        const entry = lastInference.get(item.turnId);
        const end = entry?.end;
        const text = end?.type === 'effect.completed' && end.data.effectType === 'INFER' ? assistantText(end.data.result.content) : '';
        turn.answer = item.fact.data.summary || text || '任务已完成。';
        if (text === turn.answer) turn.finalEffectId = entry?.effectId;
      }
    }
  }
  return turns;
}

export function isHumanInteraction(entry: EffectEntry): boolean {
  return entry.effect?.type === 'CALL' && entry.effect.interaction === 'human';
}

export type ActivityItem = Extract<TimelineItem, { kind: 'effect' | 'notice' }>;
export type TranscriptSection = TimelineItem | {
  kind: 'activity';
  seq: number;
  turnId: string;
  items: ActivityItem[];
};

/** 只组织阅读边界，不推断语义阶段。输入、计划、人工交互与异常不能被历史收敛吞掉。 */
export function activitySections(
  items: readonly TimelineItem[],
  pending?: { turnId: string; effectId: string },
  compact = false,
): TranscriptSection[] {
  const sections: TranscriptSection[] = [];
  const plans = planRecords(items.flatMap(item => item.kind === 'effect' ? [item.entry] : []));
  for (const item of items) {
    // 普通计划进度由底部稳定入口表达，不生成不可见的分段边界；原始事实仍在 items 中。
    if (item.kind === 'effect' && plans.get(item.entry.effectId)?.kind === 'progress') continue;
    let ordinary = false;
    if (item.kind === 'notice') ordinary = item.tone === 'info';
    if (item.kind === 'effect') {
      const entry = item.entry;
      const isPending = item.turnId === pending?.turnId && entry.effectId === pending.effectId;
      ordinary = compact
        ? !isPending && !declaredPlan(entry) && !isHumanInteraction(entry)
        : !isPending && !declaredPlan(entry) && !isHumanInteraction(entry)
        && (!entry.humanRequest || entry.humanRequest.resumed)
        && entry.end?.type !== 'effect.cancelled'
        && !['error', 'warning'].includes(operationState(entry).tone);
    }
    if (!ordinary || !('turnId' in item) || !item.turnId
      || item.kind !== 'effect' && item.kind !== 'notice') {
      sections.push(item);
      continue;
    }
    const previous = sections.at(-1);
    if (previous?.kind === 'activity' && previous.turnId === item.turnId) {
      previous.items.push(item);
    } else {
      sections.push({ kind: 'activity', seq: item.seq, turnId: item.turnId, items: [item] });
    }
  }
  return sections;
}

/** 最近六个普通调用与其前置公开进度保持原序；终态才整体收敛，未知活跃状态不冒充结束。
 * 每个重要节点划出的片段单独计算窗口，因此折叠不会跨过补充输入或授权表单。
 */
export function activityWindow(items: readonly ActivityItem[], ended: boolean) {
  if (ended) return { earlier: items, recent: [] as readonly ActivityItem[] };
  const calls = items.flatMap((item, index) => item.kind === 'effect' && item.entry.effectType !== 'INFER' ? [index] : []);
  if (calls.length <= 6) return { earlier: [] as readonly ActivityItem[], recent: items };
  const previous = calls[calls.length - 7]!;
  return { earlier: items.slice(0, previous + 1), recent: items.slice(previous + 1) };
}
