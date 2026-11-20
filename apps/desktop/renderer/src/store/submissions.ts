/** 尚未确认的提交保留原始身份；页面内导航不能把重试变成新请求。 */
import { create } from 'zustand';
import type { AgentInput, InferConfig, TurnLimits, CommandMode } from '@archer/contracts';

export interface Submission {
  mode: 'send' | 'steer' | 'followUp';
  input: AgentInput;
  commandMode?: CommandMode;
  allowShell: boolean;
  requestId: string;
  inference?: InferConfig;
  limits?: TurnLimits;
}
export interface CreationAttempt {
  id: string;
  requestId: string;
  input: AgentInput;
  workspaceAccess: 'read' | 'edit';
  commandMode?: CommandMode;
  allowShell: boolean;
  inference?: InferConfig;
  limits?: TurnLimits;
}
interface Submissions {
  messages: Record<string, Submission | undefined>;
  creations: Record<string, CreationAttempt | undefined>;
  setMessage(agentId: string, request: Submission | null): void;
  setCreation(workspace: string, request: CreationAttempt | null): void;
}
export const useSubmissions = create<Submissions>(set => ({
  messages: {}, creations: {},
  setMessage: (id, request) => set(state => {
    const messages = { ...state.messages };
    if (request) messages[id] = request;
    else delete messages[id];
    return { messages };
  }),
  setCreation: (root, request) => set(state => {
    const creations = { ...state.creations };
    if (request) creations[root] = request;
    else delete creations[root];
    return { creations };
  }),
}));
