/**
 * Archer Harness — 远程容器客户端
 *
 * 暴露 AgentManager 与 Provider 描述查询；实例始终由宿主创建。
 */

import type {
  ModelSettings,
  ModelSettingsUpdate,
  Agent,
  InferenceProgress,
  HumanTarget,
  HumanToken,
  HumanReply,
  ReconcileInput,
  AgentEvent,
  AgentListInput,
  AgentManager,
  AgentSnapshot,
  AgentSummary,
  CapabilityRef,
  CreateAgentOptions,
  EventReadInput,
  HealthInfo,
  ReadOptions,
  RenameAgentInput,
  ConfigureExecutionInput,
  SkillContent,
  Snapshot,
  WatchOptions,
  WorkspaceGitChanges,
} from '@archer/contracts';
import { InferenceProgressSchema } from '@archer/contracts';
import { openSseStream } from './sse-stream.js';
import { ApiError, HttpClient, type HttpOptions } from './http.js';
import { RemoteAgent, watchAgentEvents } from './remote-agent.js';

export interface SkillResourceDocument {
  readonly path: string;
  readonly revision: string;
  readonly content: string;
}

export class ArcherClient implements AgentManager {
  private readonly http: HttpClient;

  constructor(options: HttpOptions = {}) {
    this.http = new HttpClient(options);
  }

  skillLibrary(): Promise<{ canAdd: boolean }> {
    return this.http.request('/api/skills/library');
  }

  addSkill(content: string): Promise<{ name: string; path: string; activation: 'restart-required' }> {
    return this.http.request('/api/skills/library', {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  }

  /** 技能预览固定到已注册引用，避免刷新后把旧选择静默换成新实现。 */
  skillContent(ref: CapabilityRef, options: ReadOptions = {}): Promise<SkillContent> {
    return this.http.request(this.skillPath(ref), options.signal ? { signal: options.signal } : {});
  }

  skillResource(ref: CapabilityRef, path: string, options: ReadOptions = {}): Promise<SkillResourceDocument> {
    const query = new URLSearchParams({ path });
    return this.http.request(`${this.skillPath(ref)}/resource?${query.toString()}`, options.signal ? { signal: options.signal } : {});
  }

  private skillPath(ref: CapabilityRef): string {
    return `/api/skills/${encodeURIComponent(ref.providerId)}/${encodeURIComponent(ref.capabilityId)}/${encodeURIComponent(ref.revision)}`;
  }

  async create(options: CreateAgentOptions): Promise<Agent> {
    const created = await this.http.request<{ id: string }>('/api/agents', {
      method: 'POST',
      body: JSON.stringify(options),
    });
    return new RemoteAgent(this.http, created.id);
  }

  providers(options: ReadOptions = {}): Promise<readonly import('@archer/contracts').ProviderInfo[]> {
    return this.http.request('/api/providers', options.signal ? { signal: options.signal } : {});
  }

  async get(agentId: string, options: ReadOptions = {}): Promise<Agent | null> {
    const state = await this.agentState(agentId, options);
    return state ? new RemoteAgent(this.http, agentId) : null;
  }

  /** 读取 Agent 状态快照；不存在时返回 null */
  async agentState(
    agentId: string,
    options: ReadOptions = {},
  ): Promise<Snapshot<AgentSnapshot> | null> {
    try {
      return await this.http.request<Snapshot<AgentSnapshot>>(
        `/api/agents/${encodeURIComponent(agentId)}`,
        options.signal ? { signal: options.signal } : {},
      );
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  list(
    input: AgentListInput = {},
    options: ReadOptions = {},
  ): Promise<readonly Snapshot<AgentSummary>[]> {
    const params = new URLSearchParams();
    if (input.afterId !== undefined) params.set('afterId', input.afterId);
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    const query = params.toString();
    return this.http.request<readonly Snapshot<AgentSummary>[]>(
      `/api/agents${query ? `?${query}` : ''}`,
      options.signal ? { signal: options.signal } : {},
    );
  }

  recoveryRecords(): Promise<import('@archer/contracts').RecoveryFailure[]> {
    return this.http.request('/api/recovery-records');
  }

  exportRecoveryRecord(agentId: string): Promise<{ contentBase64: string }> {
    return this.http.request(`/api/recovery-records/${encodeURIComponent(agentId)}/export`);
  }

  isolateRecoveryRecord(agentId: string): Promise<void> {
    return this.http.request(`/api/recovery-records/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
  }

  remove(agentId: string): Promise<void> {
    return this.http.request<void>(`/api/agents/${encodeURIComponent(agentId)}`, {
      method: 'DELETE',
    });
  }

  configureExecution(agentId: string, input: ConfigureExecutionInput): Promise<void> {
    return this.http.request<void>(
      `/api/agents/${encodeURIComponent(agentId)}/execution`,
      { method: 'PUT', body: JSON.stringify(input) },
    );
  }

  rename(agentId: string, input: RenameAgentInput): Promise<void> {
    return this.http.request<void>(
      `/api/agents/${encodeURIComponent(agentId)}/title`,
      { method: 'PUT', body: JSON.stringify(input) },
    );
  }

  async *watchProgress(agentId: string, options: ReadOptions = {}): AsyncGenerator<Snapshot<InferenceProgress>> {
    for await (const message of openSseStream(this.http, `/api/agents/${encodeURIComponent(agentId)}/progress/stream`, options)) {
      let data: unknown;
      try { data = JSON.parse(message.data); } catch { continue; }
      const frame = InferenceProgressSchema.safeParse(data);
      if (frame.success && frame.data.agentId === agentId) yield frame.data as Snapshot<InferenceProgress>;
    }
  }

  issueHumanToken(agentId: string, input: HumanTarget): Promise<HumanToken> {
    return this.http.request(`/api/agents/${encodeURIComponent(agentId)}/human/token`, { method: 'POST', body: JSON.stringify(input) });
  }
  reply(agentId: string, input: HumanReply): Promise<void> {
    return this.http.request(`/api/agents/${encodeURIComponent(agentId)}/human/reply`, { method: 'POST', body: JSON.stringify(input) });
  }
  reconcile(agentId: string, input: ReconcileInput): Promise<void> {
    return this.http.request(`/api/agents/${encodeURIComponent(agentId)}/reconcile`, { method: 'POST', body: JSON.stringify(input) });
  }

  resumeQueue(agentId: string): Promise<void> {
    return this.http.request<void>(
      `/api/agents/${encodeURIComponent(agentId)}/queue/resume`,
      { method: 'POST' },
    );
  }

  clearQueue(agentId: string): Promise<void> {
    return this.http.request<void>(
      `/api/agents/${encodeURIComponent(agentId)}/queue/clear`,
      { method: 'POST' },
    );
  }

  watch(
    agentId: string,
    options: WatchOptions,
  ): AsyncIterable<Snapshot<AgentEvent>> {
    return watchAgentEvents(this.http, agentId, options);
  }

  /** Agent 事件历史；便于在建立 SSE 前渲染已有记录 */
  events(
    agentId: string,
    input: EventReadInput = {},
    options: ReadOptions = {},
  ): Promise<readonly Snapshot<AgentEvent>[]> {
    const params = new URLSearchParams();
    if (input.afterSeq !== undefined) params.set('afterSeq', String(input.afterSeq));
    if (input.beforeSeq !== undefined) params.set('beforeSeq', String(input.beforeSeq));
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    const query = params.toString();
    return this.http.request<readonly Snapshot<AgentEvent>[]>(
      `/api/agents/${encodeURIComponent(agentId)}/events${query ? `?${query}` : ''}`,
      options.signal ? { signal: options.signal } : {},
    );
  }

  modelSettings(): Promise<ModelSettings> {
    return this.http.request<ModelSettings>('/api/settings/models');
  }
  updateModelSettings(input: ModelSettingsUpdate): Promise<ModelSettings> {
    return this.http.request<ModelSettings>('/api/settings/models', { method: 'PUT', body: JSON.stringify(input) });
  }

  health(): Promise<HealthInfo> {
    return this.http.request<HealthInfo>('/api/health');
  }

  /** 读取会话工作区当前的 Git 未提交改动；不写入任务事实。 */
  workspaceGitChanges(agentId: string, options: ReadOptions & { scope?: 'all' | 'staged' | 'unstaged'; path?: string } = {}): Promise<WorkspaceGitChanges> {
    return this.http.request(
      `/api/agents/${encodeURIComponent(agentId)}/workspace/git-changes?${new URLSearchParams({ scope: options.scope ?? 'all', ...(options.path ? { path: options.path } : {}) })}`,
      options.signal ? { signal: options.signal } : {},
    );
  }
}
