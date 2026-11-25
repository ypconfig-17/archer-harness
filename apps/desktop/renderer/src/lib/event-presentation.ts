import { capabilityLabel } from './capability';
/** 已提交事实的展示投影：只把事件翻译成中文摘要，不推断未提交的状态。 */
import type { AgentEvent, Effect, Snapshot } from '@archer/contracts';
import { inputText, truncate } from './format';
import { commandAuthorizationLabel, EFFECT_TYPE_LABELS, MESSAGE_ROLE_LABELS, turnNumber } from './labels';
import { durationText, operationState } from './operation';

export type EventCategory = 'agent' | 'turn' | 'effect';
export type EventTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

export interface EventField {
  label: string;
  value: string;
  mono?: boolean;
}

export interface EventPresentation {
  title: string;
  summary: string;
  fields: readonly EventField[];
  tone: EventTone;
  category: EventCategory;
}

type TimelineEvent = Snapshot<AgentEvent>;
type AgentFact = Extract<TimelineEvent['fact'], { scope: 'agent' }>['event'];
type TurnFact = Extract<TimelineEvent['fact'], { scope: 'turn' }>['event'];
type FieldInput = [label: string, value: string | undefined, mono?: boolean];

const CALL_ACTIONS: Record<string, string> = {
  read: '读取文件',
  write: '写入文件',
  edit: '编辑文件',
  list: '浏览目录',
  grep: '搜索内容',
  glob: '查找文件',
};

const COMMAND_LABELS = {
  abort: '停止任务',
  resumeQueue: '恢复队列',
  clearQueue: '清空队列',
} as const;

function fields(inputs: readonly FieldInput[]): EventField[] {
  return inputs
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([label, value, mono]) => ({ label, value: value as string, ...(mono ? { mono: true } : {}) }));
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function callAction(path: string): string {
  return CALL_ACTIONS[path.split('/').at(-1) ?? ''] ?? '能力调用';
}

/** Effect 意图的一行目标；不读取执行结果。 */
function effectTarget(effect: Snapshot<Effect>): string {
  switch (effect.type) {
    case 'CALL': {
      const command = string(record(effect.input).command);
      return command ? `$ ${command}` : capabilityLabel(effect.target);
    }
    case 'INFER':
      return effect.config?.model ?? '默认模型';
  }
}

function effectLabel(effect: Snapshot<Effect>): string {
  return effect.type === 'CALL' ? callAction(effect.target.capabilityId) : EFFECT_TYPE_LABELS[effect.type];
}

function errorFields(error: { code: string; message: string }): FieldInput[] {
  return [
    ['错误码', error.code, true],
    ['错误信息', error.message],
  ];
}

function agentPresentation(fact: AgentFact): EventPresentation {
  switch (fact.type) {
    case 'agent.created':
      return {
        title: '会话已创建',
        summary: fact.data.workspace ? fact.data.workspace.cwd : '未绑定工作区',
        fields: fields([
          ['会话 ID', fact.data.id, true],
          ['工作区', fact.data.workspace?.cwd, true],
          ['工作区权限', fact.data.workspace ? (fact.data.workspace.access === 'edit' ? '可编辑' : '只读') : '未绑定'],
          ['推理模型', fact.data.inference.model],
          ['能力格式', fact.data.capabilityFormat],
          ['创建时间', new Date(fact.data.createdAt).toLocaleString('zh-CN', { hour12: false })],
        ]),
        tone: 'success',
        category: 'agent',
      };
    case 'input.accepted':
      return {
        title: '输入已接收',
        summary: `${fact.data.command === 'followUp' ? '排队' : '发送'}：${truncate(inputText(fact.data.input), 80)}`,
        fields: fields([
          ['输入 ID', fact.data.inputId, true],
          ['请求 ID', fact.data.requestId, true],
          ['命令授权', commandAuthorizationLabel(fact.data.allowShell, fact.data.commandMode ?? 'ask')],
          ['推理模型', fact.data.inference?.model],
          ['接收时间', new Date(fact.data.receivedAt).toLocaleString('zh-CN', { hour12: false })],
        ]),
        tone: 'info',
        category: 'agent',
      };
    case 'input.consumed':
      return {
        title: '输入已进入任务',
        summary: `已用于任务 ${turnNumber(fact.data.turnId)}`,
        fields: fields([['输入 ID', fact.data.inputId, true], ['任务', `任务 ${turnNumber(fact.data.turnId)}`]]),
        tone: 'neutral',
        category: 'agent',
      };
    case 'input.unapplied':
      return {
        title: '输入未生效',
        summary: fact.data.reason,
        fields: fields([['输入 ID', fact.data.inputId, true], ['原因', fact.data.reason]]),
        tone: 'warning',
        category: 'agent',
      };
    case 'steering.accepted':
      return {
        title: '补充要求已接收',
        summary: `${truncate(inputText(fact.data.input), 80)} · 任务 ${turnNumber(fact.data.turnId)}`,
        fields: fields([
          ['输入 ID', fact.data.inputId, true],
          ['任务', `任务 ${turnNumber(fact.data.turnId)}`],
          ['接收时间', new Date(fact.data.receivedAt).toLocaleString('zh-CN', { hour12: false })],
        ]),
        tone: 'info',
        category: 'agent',
      };
    case 'steering.consumed':
      return {
        title: '补充要求已应用',
        summary: `已用于任务 ${turnNumber(fact.data.turnId)}`,
        fields: fields([['输入 ID', fact.data.inputId, true], ['任务', `任务 ${turnNumber(fact.data.turnId)}`]]),
        tone: 'neutral',
        category: 'agent',
      };
    case 'steering.unapplied':
      return {
        title: '补充要求未生效',
        summary: fact.data.reason,
        fields: fields([
          ['输入 ID', fact.data.inputId, true],
          ['任务', `任务 ${turnNumber(fact.data.turnId)}`],
          ['原因', fact.data.reason],
        ]),
        tone: 'warning',
        category: 'agent',
      };
    case 'command.accepted':
      return {
        title: '控制命令已接收',
        summary: COMMAND_LABELS[fact.data.command],
        fields: fields([
          ['命令', COMMAND_LABELS[fact.data.command]],
          ['请求 ID', fact.data.requestId, true],
          ['签名', fact.data.signature, true],
        ]),
        tone: 'info',
        category: 'agent',
      };
    case 'queue.paused':
      return {
        title: '输入队列已暂停',
        summary: fact.data.reason,
        fields: fields([['原因', fact.data.reason]]),
        tone: 'warning',
        category: 'agent',
      };
    case 'queue.resumed':
      return { title: '输入队列已恢复', summary: '后续排队输入将继续处理', fields: [], tone: 'info', category: 'agent' };
    case 'queue.cleared':
      return {
        title: '输入队列已清空',
        summary: `移除 ${fact.data.inputIds.length} 条排队输入`,
        fields: fields([['输入 ID', fact.data.inputIds.join('、'), true]]),
        tone: 'info',
        category: 'agent',
      };
    case 'execution.configured':
      return {
        title: '执行配置已更新',
        summary: `修订 ${fact.data.revision}`,
        fields: fields([
          ['配置修订', String(fact.data.revision)],
          ['工作区权限', fact.data.workspaceAccess === 'edit' ? '可编辑' : fact.data.workspaceAccess === 'read' ? '只读' : undefined],
        ]),
        tone: 'info',
        category: 'agent',
      };
    case 'agent.renamed':
      return {
        title: '会话已重命名',
        summary: fact.data.title,
        fields: fields([
          ['新标题', fact.data.title],
          ['重命名时间', new Date(fact.data.renamedAt).toLocaleString('zh-CN', { hour12: false })],
        ]),
        tone: 'neutral',
        category: 'agent',
      };
    case 'agent.removed':
      return {
        title: '会话已删除',
        summary: '已提交的事件日志仍保留',
        fields: fields([['删除时间', new Date(fact.data.removedAt).toLocaleString('zh-CN', { hour12: false })]]),
        tone: 'warning',
        category: 'agent',
      };
  }
}

function turnPresentation(fact: TurnFact, turnId: string): EventPresentation {
  const turn = `任务 ${turnNumber(turnId)}`;
  switch (fact.type) {
    case 'turn.created':
      return {
        title: '任务已创建',
        summary: `命令${fact.data.allowShell ? commandAuthorizationLabel(true, fact.data.commandMode ?? 'ask') : '关闭'}`,
        fields: fields([
          ['任务', turn],
          ['命令授权', commandAuthorizationLabel(fact.data.allowShell, fact.data.commandMode ?? 'ask')],
          ['推理步数上限', fact.data.limits?.maxInferenceSteps?.toString()],
          ['Token 预算', fact.data.limits?.tokenBudget?.toLocaleString()],
          ['创建时间', new Date(fact.data.createdAt).toLocaleString('zh-CN', { hour12: false })],
        ]),
        tone: 'neutral',
        category: 'turn',
      };
    case 'turn.status': {
      const label = fact.data.status === 'waiting' ? '等待处理' : fact.data.status === 'cancelling' ? '等待取消确认' : '进行中';
      return {
        title: '任务状态变更',
        summary: `${label}${fact.data.reason ? ` · ${fact.data.reason}` : ''}`,
        fields: fields([['状态', label], ['原因', fact.data.reason]]),
        tone: fact.data.status === 'waiting' ? 'warning' : 'info',
        category: 'turn',
      };
    }
    case 'turn.authorization.changed':
      return {
        title: '命令授权已调整',
        summary: commandAuthorizationLabel(fact.data.allowShell, fact.data.commandMode),
        fields: fields([['命令授权', commandAuthorizationLabel(fact.data.allowShell, fact.data.commandMode)]]),
        tone: 'info',
        category: 'turn',
      };
    case 'turn.cancel.requested':
      return {
        title: '已请求停止任务',
        summary: fact.data.reason,
        fields: fields([
          ['原因', fact.data.reason],
          ['请求时间', new Date(fact.data.requestedAt).toLocaleString('zh-CN', { hour12: false })],
        ]),
        tone: 'warning',
        category: 'turn',
      };
    case 'message.appended': {
      const message = fact.data.message;
      return {
        title: message.role === 'tool' ? '工具结果已写入上下文' : '消息已写入上下文',
        summary: `${MESSAGE_ROLE_LABELS[message.role]}：${truncate(message.content, 80) || '（无文本）'}`,
        fields: fields([
          ['角色', MESSAGE_ROLE_LABELS[message.role]],
          ['内容', message.content],
          ['工具调用', message.toolCalls?.length ? `${message.toolCalls.length} 个` : undefined],
          ['工具名', message.toolName],
          ['工具调用 ID', message.toolCallId, true],
        ]),
        tone: message.role === 'tool' ? 'neutral' : 'info',
        category: 'turn',
      };
    }
    case 'completion.review.requested':
      return { title: '完成前复核', summary: '文件变更后复核验证结果或说明未验证原因', fields: fields([['操作边界', fact.data.afterEffectId, true]]), tone: 'info', category: 'turn' };
    case 'inference.requested':
      return { title: fact.data.purpose === 'compaction' ? '摘要请求已提交' : '模型请求已提交', summary: `${fact.data.request.messages.length} 条输入消息`, fields: fields([['请求 ID', fact.data.requestId, true]]), tone: 'info', category: 'effect' };
    case 'inference.responded':
      return { title: '模型响应已提交', summary: fact.data.result.usage ? `输入 ${fact.data.result.usage.promptTokens} · 输出 ${fact.data.result.usage.completionTokens} tokens` : '用量未知', fields: fields([['请求 ID', fact.data.requestId, true]]), tone: 'success', category: 'effect' };
    case 'inference.request.failed':
      return { title: '模型请求异常', summary: fact.data.error.message, fields: fields([['请求 ID', fact.data.requestId, true]]), tone: 'error', category: 'effect' };
    case 'context.compacted':
      return { title: '历史摘要已采用', summary: `覆盖前 ${fact.data.coveredMessageCount} 条历史；原始消息完整保留`, fields: fields([['请求 ID', fact.data.requestId, true]]), tone: 'info', category: 'effect' };
    case 'inference.started':
      return {
        title: '开始推理',
        summary: `第 ${fact.data.step} 步`,
        fields: fields([
          ['步数', String(fact.data.step)],
          ['开始时间', new Date(fact.data.startedAt).toLocaleString('zh-CN', { hour12: false })],
        ]),
        tone: 'info',
        category: 'effect',
      };
    case 'inference.planned': {
      const actions = fact.data.actions.map(action => `${callAction(action.target.capabilityId)} ${capabilityLabel(action.target)}`);
      const terminal = fact.data.terminal?.kind === 'done' ? '结束任务' : fact.data.terminal?.kind === 'respond' ? '生成答复' : undefined;
      return {
        title: '推理已产生计划',
        summary: `${actions.length} 个动作${terminal ? ` · ${terminal}` : ''}`,
        fields: fields([
          ['步数', String(fact.data.step)],
          ['动作', actions.join('、')],
          ['终止方式', terminal],
        ]),
        tone: 'neutral',
        category: 'effect',
      };
    }
    case 'effect.created':
      return {
        title: '操作已提交',
        summary: `${effectLabel(fact.data.effect)} · ${truncate(effectTarget(fact.data.effect), 100)}`,
        fields: fields([
          ['操作 ID', fact.data.effectId, true],
          ['类型', EFFECT_TYPE_LABELS[fact.data.effect.type]],
          ['目标', effectTarget(fact.data.effect), true],
          ['幂等键', fact.data.idempotencyKey, true],
          ['提交时间', new Date(fact.data.createdAt).toLocaleString('zh-CN', { hour12: false })],
        ]),
        tone: 'info',
        category: 'effect',
      };
    case 'effect.started':
      return {
        title: '开始执行操作',
        summary: `${EFFECT_TYPE_LABELS[fact.data.effectType]} · 第 ${fact.data.attempt} 次尝试`,
        fields: fields([
          ['操作 ID', fact.data.effectId, true],
          ['类型', EFFECT_TYPE_LABELS[fact.data.effectType]],
          ['尝试次数', String(fact.data.attempt)],
          ['开始时间', new Date(fact.data.startedAt).toLocaleString('zh-CN', { hour12: false })],
        ]),
        tone: 'info',
        category: 'effect',
      };
    case 'effect.suspended':
      return {
        title: '操作等待外部输入',
        summary: fact.data.reason,
        fields: fields([
          ['操作 ID', fact.data.effectId, true],
          ['原因', fact.data.reason],
          ['恢复凭据', fact.data.resumeTokenHash, true],
          ['过期时间', fact.data.expiresAt === undefined ? undefined : new Date(fact.data.expiresAt).toLocaleString('zh-CN', { hour12: false })],
        ]),
        tone: 'warning',
        category: 'effect',
      };
    case 'effect.resumed':
      return {
        title: '操作已恢复',
        summary: fact.data.kind === 'human' ? '收到人工输入后继续' : '按对账结果重试',
        fields: fields([
          ['操作 ID', fact.data.effectId, true],
          ['恢复方式', fact.data.kind === 'human' ? '人工输入' : '对账重试'],
          ['尝试次数', String(fact.data.attempt)],
          ['恢复时间', new Date(fact.data.resumedAt).toLocaleString('zh-CN', { hour12: false })],
        ]),
        tone: 'info',
        category: 'effect',
      };
    case 'effect.completed': {
      const data = fact.data;
      // 调用返回不等于工具成功；只读取本条回执，不沿用后来重试的最终状态。
      const resultState = operationState({ effectId: data.effectId, turnId: turn, createdAt: 0, attempt: 1, end: fact });
      const unsuccessful = resultState.tone === 'error';
      let summary = '已完成';
      if (data.effectType === 'INFER') {
        summary = data.result.usage
          ? `输入 ${data.result.usage.promptTokens.toLocaleString()} · 输出 ${data.result.usage.completionTokens.toLocaleString()} tokens · 输入中缓存读取 ${data.result.usage.cacheReadTokens?.toLocaleString() ?? '未知'} · 缓存写入 ${data.result.usage.cacheWriteTokens?.toLocaleString() ?? '未知'}`
          : truncate(data.result.content, 80) || '已完成';
      } else if (data.effectType === 'CALL') {
        summary = '已完成';
      }
      return {
        title: unsuccessful ? resultState.label : '操作已完成',
        summary: unsuccessful ? resultState.detail ?? '调用已结束，工具报告未成功' : `${EFFECT_TYPE_LABELS[data.effectType]} · ${summary}`,
        fields: fields([
          ['操作 ID', data.effectId, true],
          ['类型', EFFECT_TYPE_LABELS[data.effectType]],
          ['耗时', durationText(data.durationMs)],
          ['完成时间', new Date(data.finishedAt).toLocaleString('zh-CN', { hour12: false })],
        ]),
        tone: unsuccessful ? 'error' : 'success',
        category: 'effect',
      };
    }
    case 'effect.failed':
      return {
        title: '操作失败',
        summary: fact.data.error.message,
        fields: fields([
          ['操作 ID', fact.data.effectId, true],
          ['类型', EFFECT_TYPE_LABELS[fact.data.effectType]],
          ...errorFields(fact.data.error),
          ['耗时', fact.data.durationMs === undefined ? undefined : durationText(fact.data.durationMs)],
          ['失败时间', new Date(fact.data.finishedAt).toLocaleString('zh-CN', { hour12: false })],
        ]),
        tone: 'error',
        category: 'effect',
      };
    case 'effect.cancelled':
      return {
        title: '操作已取消',
        summary: fact.data.reason,
        fields: fields([
          ['操作 ID', fact.data.effectId, true],
          ['原因', fact.data.reason],
          ['取消时间', new Date(fact.data.finishedAt).toLocaleString('zh-CN', { hour12: false })],
        ]),
        tone: 'warning',
        category: 'effect',
      };
    case 'effect.unknown':
      return {
        title: '操作结果未知',
        summary: '外部操作可能已经生效，需要人工确认',
        fields: fields([
          ['操作 ID', fact.data.effectId, true],
          ['最后已知状态', '已开始'],
          ['检测时间', new Date(fact.data.detectedAt).toLocaleString('zh-CN', { hour12: false })],
          ...(fact.data.error ? errorFields(fact.data.error) : []),
        ]),
        tone: 'warning',
        category: 'effect',
      };
    case 'effect.abandoned':
      return {
        title: '操作已放弃追踪',
        summary: `${fact.data.reason} · 原操作结果仍未知`,
        fields: fields([
          ['操作 ID', fact.data.effectId, true],
          ['原因', fact.data.reason],
          ['放弃时间', new Date(fact.data.abandonedAt).toLocaleString('zh-CN', { hour12: false })],
        ]),
        tone: 'warning',
        category: 'effect',
      };
    case 'turn.completed':
      return {
        title: '任务已完成',
        summary: fact.data.summary ?? (fact.data.stopReason === 'respond' ? '已生成回复' : '已完成'),
        fields: fields([
          ['结束方式', fact.data.stopReason === 'respond' ? '生成答复' : '完成'],
          ['完成时间', new Date(fact.data.completedAt).toLocaleString('zh-CN', { hour12: false })],
        ]),
        tone: 'success',
        category: 'turn',
      };
    case 'turn.failed':
      return {
        title: '任务失败',
        summary: fact.data.error.message,
        fields: fields([
          ...errorFields(fact.data.error),
          ['失败时间', new Date(fact.data.completedAt).toLocaleString('zh-CN', { hour12: false })],
        ]),
        tone: 'error',
        category: 'turn',
      };
    case 'turn.cancelled':
      return {
        title: '任务已取消',
        summary: fact.data.reason || '取消已确认',
        fields: fields([
          ['原因', fact.data.reason],
          ['取消时间', new Date(fact.data.completedAt).toLocaleString('zh-CN', { hour12: false })],
        ]),
        tone: 'warning',
        category: 'turn',
      };
  }
}

/** 事件类型到中文展示的纯投影；未提交的结果不会出现在字段里。 */
export function describeEvent(event: TimelineEvent): EventPresentation {
  return event.fact.scope === 'agent'
    ? agentPresentation(event.fact.event)
    : turnPresentation(event.fact.event, event.fact.turnId);
}
