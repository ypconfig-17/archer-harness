/**
 * Archer Harness — Agent 级生命周期事实折叠
 *
 * 负责将 agent.created、输入队列、steering、配置修订与移除事实折叠到 SessionState。
 */

import type { AgentDraft } from '@archer/contracts';
import { ArcherError } from '@archer/contracts';
import { requestSignature, type SessionState } from './session-state.js';

export function corrupt(message: string): never {
  throw new ArcherError('EVENT_LOG_CORRUPT', message);
}

/** 折叠单条 Agent 作用域事实；已有 state 会被原地更新。 */
export function applyLifecycle(
  state: SessionState | null,
  fact: Extract<AgentDraft, { scope: 'agent' }>['event'],
): SessionState {
  if (!state) {
    if (fact.type !== 'agent.created') corrupt('Agent 日志首事实必须是 agent.created');
    const created = fact.data;
    if (!created.policyId) corrupt('创建事实缺少策略身份');
    if (created.capabilityFormat !== 'provider') corrupt('创建事实缺少 Provider 能力格式声明');
    return {
      agentId: created.id,
      seq: 0,
      createdAt: created.createdAt,
      createKey: created.createKey,
      policyId: created.policyId,
      workspace: created.workspace,
      instructions: created.instructions,
      inference: created.inference,
      executionRevision: 0,
      messages: [],
      compactions: [],
      queue: [],
      queuePaused: false,
      pendingSteering: [],
      activeTurnId: null,
      turns: new Map(),
      requests: new Map(),
      inputCount: 0,
      removed: false,
    };
  }

  switch (fact.type) {
    case 'agent.created':
      corrupt('Agent 日志包含重复的 agent.created');
      break;
    case 'input.accepted': {
      const data = fact.data;
      state.inputCount += 1;
      state.queue.push({
        inputId: data.inputId,
        requestId: data.requestId,
        input: data.input,
        allowShell: data.allowShell,
        commandMode: data.commandMode ?? 'ask',
        ...(data.inference ? { inference: data.inference } : {}),
        ...(data.limits ? { limits: data.limits } : {}),
      });
      state.requests.set(data.requestId, {
        command: data.command,
        signature: requestSignature(data.command, data.input, {
          allowShell: data.allowShell,
          commandMode: data.commandMode ?? 'ask',
          limits: data.limits,
          inference: data.inference,
        }),
        inputId: data.inputId,
      });
      break;
    }
    case 'input.consumed': {
      const index = state.queue.findIndex((item) => item.inputId === fact.data.inputId);
      if (index < 0) corrupt(`input.consumed 引用了不在队列中的输入：${fact.data.inputId}`);
      state.queue.splice(index, 1);
      for (const record of state.requests.values()) {
        if (record.inputId === fact.data.inputId) record.turnId = fact.data.turnId;
      }
      break;
    }
    case 'input.unapplied': {
      const index = state.queue.findIndex((item) => item.inputId === fact.data.inputId);
      if (index < 0) corrupt(`input.unapplied 引用了不在队列中的输入：${fact.data.inputId}`);
      state.queue.splice(index, 1);
      break;
    }
    case 'steering.accepted': {
      const data = fact.data;
      state.pendingSteering.push({
        inputId: data.inputId,
        requestId: data.requestId,
        input: data.input,
        turnId: data.turnId,
      });
      state.requests.set(data.requestId, {
        command: 'steer',
        signature: requestSignature('steer', data.input, { turnId: data.turnId }),
        inputId: data.inputId,
        turnId: data.turnId,
      });
      break;
    }
    case 'steering.consumed':
    case 'steering.unapplied': {
      const index = state.pendingSteering.findIndex(
        (item) => item.inputId === fact.data.inputId,
      );
      if (index < 0) corrupt(`steer 事实引用了不在待处理集合中的输入：${fact.data.inputId}`);
      state.pendingSteering.splice(index, 1);
      break;
    }
    case 'command.accepted': {
      const data = fact.data;
      state.requests.set(data.requestId, {
        command: data.command,
        signature: data.signature,
      });
      break;
    }
    case 'queue.paused':
      state.queuePaused = true;
      break;
    case 'queue.resumed':
      state.queuePaused = false;
      break;
    case 'queue.cleared': {
      const removed = new Set(fact.data.inputIds);
      state.queue = state.queue.filter((item) => !removed.has(item.inputId));
      break;
    }
    case 'execution.configured':
      if (
        fact.data.expectedRevision !== state.executionRevision ||
        fact.data.revision !== state.executionRevision + 1
      ) {
        corrupt('执行配置修订不连续');
      }
      if (fact.data.workspaceAccess) {
        if (!state.workspace) corrupt('工作环境访问变更缺少工作环境');
        state.workspace = { ...state.workspace!, access: fact.data.workspaceAccess };
      }
      state.executionRevision = fact.data.revision;
      break;
    case 'agent.renamed':
      state.title = fact.data.title;
      break;
    case 'agent.removed':
      state.removed = true;
      state.removedAt = fact.data.removedAt;
      state.activeTurnId = null;
      state.queue = [];
      state.pendingSteering = [];
      break;
    default:
      corrupt('未知的 Agent 生命周期事实');
  }
  return state;
}
