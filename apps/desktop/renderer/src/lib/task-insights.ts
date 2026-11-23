/** 洞察只读取已提交事实；窗口不完整时不声称覆盖整个任务。 */
import { TaskPlanSchema, type TaskPlan } from '@archer/contracts';
import type { EffectEntry } from './conversation';
import { fileChange, resultMetadata, type FileChangeView } from './operation';

export function taskChanges(entries: readonly EffectEntry[]): FileChangeView[] {
  const changes: FileChangeView[] = [];
  const last = new Map<string, FileChangeView>();
  for (const entry of entries) {
    const change = fileChange(entry);
    if (!change) continue;
    const previous = last.get(change.path);
    // 中间发生外部写入时保留独立片段，不能拼成不存在的连续修改。
    if (previous && change.before !== undefined && previous.after === change.before) previous.after = change.after;
    else { const next = { ...change }; changes.push(next); last.set(change.path, next); }
  }
  return changes;
}

export type TaskChangeKind = 'added' | 'modified' | 'unknown';

export interface TaskChangeFile {
  path: string;
  name: string;
  directory?: string;
  kind: TaskChangeKind;
}

export interface TaskChangeSummary {
  files: number;
  modified: number;
  added: number;
  unknown: number;
}

/**
 * 单段写入的确认程度：`before` 或 `revisionBefore` 为 null 表示创建；
 * 缺少 before 且没有可用 revisionBefore 时原文未知，不把未知写入猜成修改或新增。
 */
function changeKind(change: FileChangeView): TaskChangeKind {
  if (change.before === null || change.revisionBefore === null) return 'added';
  if (change.before === undefined && typeof change.revisionBefore !== 'string') return 'unknown';
  return 'modified';
}

// 同一文件的多个片段只在列表占一行，状态取可确认性最高的一段。
const CHANGE_RANK: Record<TaskChangeKind, number> = { modified: 0, unknown: 1, added: 2 };

/**
 * 文件列表按首次出现顺序去重，合并同一路径的全部片段；
 * 名称与目录只服务阅读，完整路径保留在 `path`，不据此推断文件类型或变更结果。
 */
export function taskChangeFiles(entries: readonly EffectEntry[]): TaskChangeFile[] {
  const files = new Map<string, TaskChangeFile>();
  for (const change of taskChanges(entries)) {
    const kind = changeKind(change);
    const existing = files.get(change.path);
    if (existing) {
      if (CHANGE_RANK[kind] > CHANGE_RANK[existing.kind]) existing.kind = kind;
      continue;
    }
    const parts = change.path.split(/[\\/]/);
    const name = parts.pop() || change.path;
    files.set(change.path, {
      path: change.path,
      name,
      directory: name !== change.path && parts.length ? parts.join('/') || '/' : undefined,
      kind,
    });
  }
  return [...files.values()];
}

/** 文件数按去重后的路径统计；多个片段不能重复计成多个文件。 */
export function summarizeChangeFiles(files: readonly TaskChangeFile[]): TaskChangeSummary {
  let modified = 0;
  let added = 0;
  let unknown = 0;
  for (const file of files) {
    if (file.kind === 'added') added++;
    else if (file.kind === 'unknown') unknown++;
    else modified++;
  }
  return { files: files.length, modified, added, unknown };
}

/** 只有成功提交的合法声明参与计划投影，请求、错误与未知结果都不能推进版本。 */
export function declaredPlan(entry: EffectEntry): TaskPlan | undefined {
  if (entry.end?.type !== 'effect.completed' || entry.end.data.effectType !== 'CALL'
    || entry.end.data.result.isError) return undefined;
  const parsed = TaskPlanSchema.safeParse(resultMetadata(entry).plan);
  return parsed.success ? parsed.data : undefined;
}
export function taskPlan(entries: readonly EffectEntry[]): TaskPlan | undefined {
  return [...entries].reverse().map(declaredPlan).find(plan => plan !== undefined);
}
export interface PlanRecord {
  plan: TaskPlan;
  kind: 'created' | 'revised' | 'progress' | 'snapshot';
  previous?: TaskPlan;
  versions: TaskPlan[];
}
/** 仅比较显式身份与阶段结构；状态推进不制造新的计划历史节点。 */
export function planRecords(entries: readonly EffectEntry[]): Map<string, PlanRecord> {
  const records = new Map<string, PlanRecord>();
  const latest = new Map<string, TaskPlan>();
  const histories = new Map<string, TaskPlan[]>();
  for (const entry of entries) {
    const plan = declaredPlan(entry);
    if (!plan) continue;
    const target = entry.effect?.type === 'CALL' ? entry.effect.target : undefined;
    const key = JSON.stringify([entry.turnId, target?.providerId, target?.capabilityId, target?.contractId, target?.revision, plan.planId]);
    const previous = latest.get(key);
    const changed = previous && (previous.title !== plan.title
      || JSON.stringify(previous.steps.map(step => step.text)) !== JSON.stringify(plan.steps.map(step => step.text)));
    const versions = histories.get(key) ?? [];
    versions.push(plan);
    histories.set(key, versions);
    records.set(entry.effectId, {
      plan, previous, versions,
      kind: plan.revision === 1 ? 'created' : !previous ? 'snapshot' : changed ? 'revised' : 'progress',
    });
    latest.set(key, plan);
  }
  return records;
}

export function inferenceContext(entries: readonly EffectEntry[]) {
  const entry = [...entries].reverse().find(item => item.effect?.type === 'INFER');
  if (entry?.effect?.type !== 'INFER') return undefined;
  const request = entry.inferenceRequests?.at(-1);
  const effect = request?.request ?? entry.effect;
  const result = request?.result;
  return { effect, usage: result?.usage, preparations: result?.preparations,
    reasoningLevel: result?.reasoningLevel ?? effect.config?.reasoning, purpose: request?.purpose, sent: Boolean(request),
    contextPlan: result?.contextPlan };
}
