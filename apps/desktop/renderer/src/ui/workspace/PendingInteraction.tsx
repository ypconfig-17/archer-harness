import { capabilityLabel } from '../../lib/capability';
/** 人工回复与对账是显式宿主命令，不使用普通聊天或 steer 代替。 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TurnSnapshot, ReconcileInput } from '@archer/contracts';
import { client } from '../../lib/api';
import {
  Button,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Icon,
  InteractionCard,
  RadioGroup,
  RadioGroupItem,
  Textarea,
} from '@archer/ui';
import type { TimelineEvent } from '../../lib/conversation';
import { record } from '../../lib/operation';

export function PendingInteraction({ agentId, turn, events, workspacePath }: {
  agentId: string;
  turn: TurnSnapshot;
  events: readonly TimelineEvent[];
  workspacePath?: string;
}) {
  const pending = turn.pending;
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (pending) section.current?.focus({ preventScroll: true });
  }, [pending?.effectId]);
  const isCommand = pending?.kind === 'human' && pending.purpose === 'command';
  const queries = useQueryClient();
  const [response, setResponse] = useState('');
  const [selectedOption, setSelectedOption] = useState('');
  const [showAnswer, setShowAnswer] = useState(false);
  const [checked, setChecked] = useState(false);
  const target = { turnId: turn.turnId, effectId: pending?.effectId ?? '' };
  const mutation = useMutation({
    mutationFn: async (command: { approved: boolean } | ReconcileInput['decision']) => {
      if ('approved' in command) {
        const token = await client.issueHumanToken(agentId, target);
        await client.reply(agentId, { ...target, token: token.token, approved: command.approved, response: [selectedOption, response.trim()].filter(Boolean).join('\n\n') });
      } else await client.reconcile(agentId, { ...target, decision: command });
    },
    onSettled: async () => {
      await Promise.all([queries.invalidateQueries({ queryKey: ['agent', agentId] }), queries.invalidateQueries({ queryKey: ['agents'] })]);
    },
  });
  const submitting = mutation.isPending || mutation.isSuccess;
  // 结束事实优先于尚未刷新的 pending 快照，避免已结束任务继续暴露重试按钮。
  // 取消请求本身不是终态；结果未知且仍待对账的任务必须保留人工处理入口。
  const ended = ['completed', 'failed', 'cancelled'].includes(turn.status)
    || events.some(event => event.fact.scope === 'turn' && event.fact.turnId === turn.turnId
      && ['turn.completed', 'turn.failed', 'turn.cancelled'].includes(event.fact.event.type));
  if (!pending || ended) return null;
  const humanTitle = isCommand ? '需要授权执行命令' : pending.kind === 'human' && pending.options?.length ? '需要你的确认' : '等待你的回答';
  const original = events.find(event => event.fact.scope === 'turn' && event.fact.turnId === turn.turnId && event.fact.event.type === 'effect.created' && event.fact.event.data.effectId === pending.effectId);
  const effect = original?.fact.scope === 'turn' && original.fact.event.type === 'effect.created' ? original.fact.event.data.effect : undefined;
  const input = effect?.type === 'CALL' ? record(effect.input) : {};
  const command = input.command;
  const commandDirectory = typeof input.cwd === 'string' ? input.cwd : undefined;
  const cancelled = events.some(event => event.fact.scope === 'turn' && event.fact.turnId === turn.turnId && event.fact.event.type === 'turn.cancel.requested');
  return <section ref={section} tabIndex={-1} className="pending-interaction" aria-label={pending.kind === 'human' ? isCommand ? '等待命令授权' : humanTitle : '需要人工对账'}>
    <InteractionCard
      title={pending.kind === 'human' ? humanTitle : '外部操作结果未知'}
      icon={<Icon name={isCommand ? 'shield' : 'info'} size="md" />}
      meta={isCommand && <span className="pending-command-kind"><Icon name="terminal" size="xs" />终端命令</span>}
      actions={pending.kind === 'human' ? (
        <>
          <Button variant="secondary" disabled={submitting} onClick={() => mutation.mutate({ approved: false })}>
            拒绝并结束任务
          </Button>
          <Button variant="default" disabled={submitting || !isCommand && !selectedOption && !response.trim()} onClick={() => mutation.mutate({ approved: true })}>
            {mutation.isPending ? '正在提交…' : mutation.isSuccess ? '正在同步记录…' : isCommand ? '允许本次执行' : pending.kind === 'human' && pending.options?.length ? '确认并继续' : '提交回答'}
          </Button>
        </>
      ) : (
        <>
          <Button variant="secondary" disabled={submitting || !response.trim()} onClick={() => mutation.mutate({ kind: 'abandon', reason: response.trim() })}>
            放弃追踪并结束任务
          </Button>
          <Button
            variant="default"
            disabled={submitting || !checked || cancelled}
            onClick={() => mutation.mutate({ kind: 'retry' })}
            title={cancelled ? '已请求取消，不能重试' : undefined}
          >
            明确重试原操作
          </Button>
        </>
      )}
    >
      {isCommand ? <div className="pending-command-preview">
        <p className="pending-command-subtitle">请核对下方完整命令。本次授权仅允许这一条命令执行。</p>
        <dl className="pending-command-location">
          <dt><Icon name="folder" size="sm" />{commandDirectory ? '命令目录（参数）' : '当前工作区'}</dt>
          <dd>{commandDirectory ?? workspacePath ?? '未加载目录信息'}</dd>
        </dl>
        <pre><code>{typeof command === 'string' ? command : pending.kind === 'human' ? pending.reason : ''}</code></pre>
      </div> : <p>{pending.kind === 'human' ? pending.reason : `无法确认 ${capabilityLabel(pending.target)} 的操作是否已生效。请先核查外部状态。`}</p>}
      {pending.kind === 'human' && pending.options && (
        <RadioGroup
          className="pending-options"
          aria-label="选择处理方式"
          value={selectedOption}
          onValueChange={value => setSelectedOption(value as string)}
          disabled={submitting}
        >
          {pending.options.map(option => (
            <label className="pending-option" data-selected={selectedOption === option || undefined} key={option}>
              <RadioGroupItem value={option} />
              <span>{option}</span>
            </label>
          ))}
          {selectedOption && (
            <Button variant="link" size="xs" disabled={submitting} onClick={() => setSelectedOption('')}>
              清除选择
            </Button>
          )}
        </RadioGroup>
      )}
      {pending.kind === 'human' && Boolean(pending.options?.length) && <Button variant="link" size="xs" className="pending-answer-toggle" aria-expanded={showAnswer} aria-controls={`answer-${pending.effectId}`} onClick={() => setShowAnswer(!showAnswer)}><Icon name={showAnswer ? 'chevron-down' : 'plus'} size="xs" />{showAnswer ? '收起补充说明' : response.trim() ? '已填写补充说明 · 展开' : '补充说明 / 自定义回答'}</Button>}
      {(!isCommand && (pending.kind === 'reconcile' || !pending.options?.length || showAnswer)) && <Textarea id={`answer-${pending.effectId}`} aria-label={pending.kind === 'human' ? '回答内容' : '放弃追踪的原因'} placeholder={pending.kind === 'human' ? selectedOption ? '补充这个选项的说明…' : '输入你的回答…' : '填写放弃追踪的原因…'} disabled={submitting} value={response} onChange={event => setResponse(event.target.value)} />}

      {pending.kind === 'reconcile' && <label className="reconcile-check"><Checkbox checked={checked} disabled={submitting} onCheckedChange={setChecked} />我已核查外部状态，理解重试可能重复产生副作用。</label>}
      {mutation.error && <div role="alert" className="error-banner">{mutation.error.message}</div>}
      <Collapsible className="pending-details">
        <CollapsibleTrigger>查看操作详情与权限说明</CollapsibleTrigger>
        <CollapsibleContent keepMounted>
          {isCommand && <p><Icon name="terminal" size="xs" />{effect?.type === 'CALL' ? capabilityLabel(effect.target) : '本次命令'}{!commandDirectory ? ' · 命令未单独指定目录，由宿主工作环境解析。' : ''}</p>}
          <p>{pending.kind === 'human' ? isCommand ? '本次批准只允许执行当前命令，不扩大工作区或后续命令权限。命令使用服务进程的系统权限，可访问工作区外文件和网络。' : '回答只处理本次询问，不扩大工作区或命令权限。' : '放弃追踪会结束当前任务，但不会撤销操作，也不能证明它没有发生。'}</p>
          {effect && <pre>{JSON.stringify(effect, null, 2)}</pre>}
        </CollapsibleContent>
      </Collapsible>
    </InteractionCard>
  </section>;
}
