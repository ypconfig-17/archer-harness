import { useProgress } from '../store/progress';
import { traceStream } from '../lib/stream-diagnostics';
/**
 * Agent / Turn 数据查询与命令钩子。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import type {
  InferenceProgress,
  InferConfig,
  TurnLimits,
  Agent,
  AgentEvent,
  AgentInput,
  AgentSummary,
  CapabilityRef,
  CreateAgentOptions,
  HealthInfo,
  Snapshot,
  TurnSnapshot,
} from '@archer/contracts';
import { client } from '../lib/api';
import { loadAgentList } from '../lib/agent-list';
import { useAgentStreamStore } from '../store/agent-stream';

const EMPTY_EVENTS: readonly Snapshot<AgentEvent>[] = [];
const EMPTY_TURNS: readonly Snapshot<TurnSnapshot>[] = [];
const TURN_PAGE_SIZE = 50;

async function withAgent<T>(
  agentId: string,
  action: (agent: Agent) => Promise<T>,
): Promise<T> {
  const agent = await client.get(agentId);
  if (!agent) throw new Error(`Agent 不存在：${agentId}`);
  return action(agent);
}

export function useHealth() {
  return useQuery<HealthInfo>({
    queryKey: ['health'],
    queryFn: () => client.health(),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 1,
  });
}

export function useAgents() {
  return useQuery<readonly Snapshot<AgentSummary>[]>({
    queryKey: ['agents'],
    queryFn: ({ signal }) => loadAgentList((input, options) => client.list(input, options), signal),
    refetchInterval: 3000,
  });
}

export function useAgentState(agentId: string | null) {
  return useQuery({
    queryKey: ['agent', agentId],
    queryFn: () => client.agentState(agentId as string),
    enabled: Boolean(agentId),
    refetchInterval: 2000,
  });
}

/** 列表视图批量读取会话快照；与侧栏共用缓存键，不额外发起请求。 */
export function useAgentStates(agentIds: readonly string[]) {
  return useQueries({
    queries: agentIds.map((agentId) => ({
      queryKey: ['agent', agentId],
      queryFn: () => client.agentState(agentId),
      staleTime: 3000,
    })),
  });
}

export interface AgentTurnIndex {
  turns: readonly Snapshot<TurnSnapshot>[];
  /** 服务端仍有更早的 Turn 元数据 */
  hasOlder: boolean;
  loadingOlder: boolean;
  /** 按 agentSeq 向前读取一页更早的 Turn 元数据 */
  loadOlder(): Promise<void>;
}

/** 任务索引：最近一页随会话刷新，更早的 Turn 独立分页，不受事件窗口限制。 */
export function useAgentTurns(agentId: string | null): AgentTurnIndex {
  const query = useQuery<readonly Snapshot<TurnSnapshot>[]>({
    queryKey: ['agent-turns', agentId],
    queryFn: () => withAgent(agentId as string, (agent) => agent.turns.list({ limit: TURN_PAGE_SIZE })),
    enabled: Boolean(agentId),
    refetchInterval: 2000,
  });
  const [older, setOlder] = useState<readonly Snapshot<TurnSnapshot>[]>(EMPTY_TURNS);
  const [exhaustedFor, setExhaustedFor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  useEffect(() => {
    setOlder(EMPTY_TURNS);
    setExhaustedFor(null);
  }, [agentId]);

  const turns = useMemo(() => {
    const byId = new Map<string, Snapshot<TurnSnapshot>>();
    for (const turn of older) {
      if (turn.agentId === agentId) byId.set(turn.turnId, turn);
    }
    for (const turn of query.data ?? EMPTY_TURNS) byId.set(turn.turnId, turn);
    return [...byId.values()].sort((a, b) => b.agentSeq - a.agentSeq);
  }, [agentId, older, query.data]);

  const loadOlder = useCallback(async () => {
    if (!agentId || loadingOlder) return;
    const cursor = turns.at(-1)?.agentSeq;
    if (cursor === undefined) return;
    setLoadingOlder(true);
    try {
      const page = await withAgent(agentId, (agent) => agent.turns.list({ beforeAgentSeq: cursor, limit: TURN_PAGE_SIZE }));
      setOlder((previous) => [...previous, ...page]);
      if (page.length < TURN_PAGE_SIZE) setExhaustedFor(agentId);
    } finally {
      setLoadingOlder(false);
    }
  }, [agentId, loadingOlder, turns]);

  return {
    turns,
    hasOlder: exhaustedFor !== agentId && (query.data?.length ?? 0) >= TURN_PAGE_SIZE,
    loadingOlder,
    loadOlder,
  };
}

export function useProviders() {
  return useQuery({ queryKey: ['providers'], queryFn: ({ signal }) => client.providers({ signal }), staleTime: 10_000 });
}

/** 技能正文只在打开详情时读取；固定引用不随 providers 刷新改变。 */
export function useSkillContent(ref: CapabilityRef | null) {
  return useQuery({
    queryKey: ['skill-content', ref?.providerId, ref?.capabilityId, ref?.revision],
    queryFn: ({ signal }) => client.skillContent(ref!, { signal }),
    enabled: ref !== null,
    staleTime: 30_000,
  });
}

/** 资源预览按需打开，缓存固定到技能引用与相对路径。 */
export function useSkillResource(ref: CapabilityRef, path: string, enabled: boolean) {
  return useQuery({
    queryKey: ['skill-resource', ref.providerId, ref.capabilityId, ref.revision, path],
    queryFn: ({ signal }) => client.skillResource(ref, path, { signal }),
    enabled,
    staleTime: 30_000,
  });
}

export interface AgentEventWindow {
  events: readonly Snapshot<AgentEvent>[];
  /** 当前缓存尚未覆盖会话最早事件 */
  hasEarlier: boolean;
  loadingEarlier: boolean;
  /** 读取当前窗口之前的一页；不改变已有事件 */
  loadEarlier(): Promise<void>;
  /** 向前或向后补齐事件，直到缓存覆盖指定 Agent 序号 */
  loadThrough(agentSeq: number): Promise<void>;
}

/** 先补最近一页历史事件，再订阅增量推送；向上翻页独立读取更早窗口。 */
export function useAgentEvents(
  agentId: string | null,
  expectedSeq?: number,
  reconnectVersion = 0,
): AgentEventWindow {
  const appendEvents = useAgentStreamStore((state) => state.appendEvents);
  const setError = useAgentStreamStore(state => state.setError);
  const events = useAgentStreamStore(state =>
    agentId ? (state.eventsByAgent[agentId] ?? EMPTY_EVENTS) : EMPTY_EVENTS,
  );
  const queryClient = useQueryClient();
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const historyQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!agentId) return;

    const controller = new AbortController();
    let disposed = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    setError(agentId, null);

    void (async () => {
      // 首次进入尚未取得水位时先读一次状态，确保从最近一页而不是最早一页开始。
      let highWater = expectedSeq;
      if (highWater === undefined) {
        const snapshot = await client.agentState(agentId, { signal: controller.signal });
        if (disposed) return;
        highWater = snapshot?.seq;
      }
      const history = highWater === undefined
        ? await client.events(agentId, { limit: 500 })
        : await client.events(agentId, { beforeSeq: highWater + 1, limit: 500 });
      if (disposed) return;
      appendEvents(agentId, history);

      const afterSeq = history.at(-1)?.seq ?? 0;
      for await (const event of client.watch(agentId, {
        afterSeq,
        signal: controller.signal,
      })) {
        if (disposed) return;
        appendEvents(agentId, [event]);
        if (refreshTimer === undefined) refreshTimer = setTimeout(() => {
          refreshTimer = undefined;
          void queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
          void queryClient.invalidateQueries({ queryKey: ['agents'] });
        }, 100);
      }
    })().catch((error: unknown) => {
      if (!disposed) setError(agentId, (error as Error).message);
    });

    return () => {
      disposed = true;
      clearTimeout(refreshTimer);
      controller.abort();
    };
  }, [agentId, appendEvents, setError, queryClient, reconnectVersion]);

  // 快照领先于事件缓存时按游标补齐，覆盖重连期间遗漏的展示事实。
  useEffect(() => {
    if (!agentId || expectedSeq === undefined) return;
    let disposed = false;
    // 首屏窗口尚未落地时由初始窗口负责；从 0 补齐会把分页退化成全量读取。
    const latest = useAgentStreamStore.getState().eventsByAgent[agentId]?.at(-1)?.seq;
    if (latest === undefined || latest >= expectedSeq) return;
    let cursor = latest;
    void (async () => {
      while (!disposed && cursor < expectedSeq) {
        const page = await client.events(agentId, { afterSeq: cursor, limit: 500 });
        if (disposed || page.length === 0) return;
        appendEvents(agentId, page);
        cursor = page.at(-1)!.seq;
      }
    })().catch((error: unknown) => {
      if (!disposed) setError(agentId, (error as Error).message);
    });
    return () => { disposed = true; };
  }, [agentId, expectedSeq, appendEvents, setError]);

  // 历史窗口读取串行执行，避免翻页与定位同时读取同一段。
  const enqueueHistory = useCallback((task: () => Promise<void>): Promise<void> => {
    const pending = historyQueue.current.then(task, task);
    historyQueue.current = pending.catch(() => undefined);
    return pending;
  }, []);

  const loadPageBefore = useCallback(async (before: number): Promise<number> => {
    if (!agentId) return 0;
    const page = await client.events(agentId, { beforeSeq: before, limit: 500 });
    if (page.length > 0) appendEvents(agentId, page);
    return page.length;
  }, [agentId, appendEvents]);

  const loadEarlier = useCallback(async () => {
    if (!agentId || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      await enqueueHistory(async () => {
        const before = useAgentStreamStore.getState().eventsByAgent[agentId]?.[0]?.seq;
        if (before === undefined || before <= 1) return;
        await loadPageBefore(before);
      });
    } catch (error: unknown) {
      setError(agentId, (error as Error).message);
    } finally {
      setLoadingEarlier(false);
    }
  }, [agentId, enqueueHistory, loadPageBefore, setError, loadingEarlier]);

  const loadThrough = useCallback(async (targetAgentSeq: number) => {
    if (!agentId) return;
    try {
      await enqueueHistory(async () => {
        for (;;) {
          let cached = useAgentStreamStore.getState().eventsByAgent[agentId] ?? [];
          if (cached.length === 0) {
            // 首屏窗口尚未到达时先取得最近一页，避免定位直接失败。
            const seed = expectedSeq === undefined
              ? await client.events(agentId, { limit: 500 })
              : await client.events(agentId, { beforeSeq: expectedSeq + 1, limit: 500 });
            if (seed.length === 0) return;
            appendEvents(agentId, seed);
            cached = useAgentStreamStore.getState().eventsByAgent[agentId] ?? [];
            if (cached.length === 0) return;
          }
          const earliest = cached[0]!.seq;
          const latest = cached.at(-1)!.seq;
          if (earliest > targetAgentSeq) {
            if (await loadPageBefore(earliest) === 0) return;
            continue;
          }
          if (latest < targetAgentSeq) {
            const page = await client.events(agentId, { afterSeq: latest, limit: 500 });
            if (page.length === 0) return;
            appendEvents(agentId, page);
            continue;
          }
          return;
        }
      });
    } catch (error: unknown) {
      setError(agentId, (error as Error).message);
      throw error;
    }
  }, [agentId, appendEvents, enqueueHistory, expectedSeq, loadPageBefore, setError]);

  return {
    events,
    hasEarlier: (events[0]?.seq ?? 1) > 1,
    loadingEarlier,
    loadEarlier,
    loadThrough,
  };
}

/** 临时推理快照独立订阅，不和 Agent 日志游标混用；仅维护连接与按帧写入，不触发外层组件订阅。 */
export function useInferenceProgress(agentId: string, reconnectVersion: number): void {
  const update = useProgress(state => state.update);
  const release = useProgress(state => state.release);
  useEffect(() => {
    const controller = new AbortController();
    const pending = new Map<string, Snapshot<InferenceProgress>>();
    let scheduled: number | undefined;
    const flush = () => {
      scheduled = undefined;
      if (controller.signal.aborted) return;
      update(...pending.values());
      pending.clear();
    };
    void (async () => {
      for await (const frame of client.watchProgress(agentId, { signal: controller.signal })) {
        if (controller.signal.aborted) return;
        traceStream('Renderer', frame.effectId, frame.content.length, frame.phase);
        // 快照是累计正文，同一绘制帧只需最新值；读取循环不等待 Markdown 提交。
        // 按 effectId 分开保留，不能让下一次推理覆盖上一帧的收束状态。
        pending.set(frame.effectId, frame);
        if (scheduled === undefined) scheduled = requestAnimationFrame(flush);
      }
    })().catch(() => {
      // 事实流仍是权威来源；临时通道不可用时继续显示执行状态。
    });
    return () => {
      controller.abort();
      if (scheduled !== undefined) cancelAnimationFrame(scheduled);
      pending.clear();
      // 临时流只在当前会话可见；离开后丢弃，避免按 effectId 无限累积。
      release(agentId);
    };
  }, [agentId, reconnectVersion, update, release]);
}

function useInvalidatingMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  keys: QueryKey[],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all(
        keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    },
  });
}

export function useCreateAgent() {
  return useInvalidatingMutation(
    (options: CreateAgentOptions) => client.create(options),
    [['agents']],
  );
}

export function useSendMessage(agentId: string) {
  return useInvalidatingMutation(
    (variables: { input: AgentInput; commandMode?: import('@archer/contracts').CommandMode; allowShell?: boolean; requestId?: string; inference?: InferConfig; limits?: TurnLimits }) =>
      withAgent(agentId, (agent) =>
        agent.send(
          variables.input,
          { ...(variables.commandMode ? { commandMode: variables.commandMode } : {}), ...(variables.inference ? { inference: variables.inference } : {}), ...(variables.limits ? { limits: variables.limits } : {}), ...(variables.allowShell === undefined ? {} : { allowShell: variables.allowShell }), ...(variables.requestId === undefined ? {} : { requestId: variables.requestId }) },
        ),
      ),
    [['agent', agentId], ['agent-turns', agentId]],
  );
}

export function useSteerMessage(agentId: string) {
  return useInvalidatingMutation(
    (variables: { input: AgentInput; requestId: string }) => withAgent(agentId, (agent) => agent.steer(variables.input, { requestId: variables.requestId })),
    [['agent', agentId], ['agent-turns', agentId]],
  );
}

export function useFollowUpMessage(agentId: string) {
  return useInvalidatingMutation(
    (variables: { input: AgentInput; requestId: string; inference?: InferConfig; limits?: TurnLimits }) => withAgent(agentId, (agent) => agent.followUp(variables.input, { requestId: variables.requestId, ...(variables.inference ? { inference: variables.inference } : {}), ...(variables.limits ? { limits: variables.limits } : {}) })),
    [['agent', agentId], ['agent-turns', agentId]],
  );
}

export function useAbortAgent(agentId: string) {
  return useInvalidatingMutation(
    (turnId?: string) =>
      withAgent(agentId, (agent) =>
        agent.abort(turnId === undefined ? {} : { turnId }),
      ),
    [['agent', agentId], ['agent-turns', agentId]],
  );
}

export function useResumeQueue(agentId: string) {
  return useInvalidatingMutation(
    () => client.resumeQueue(agentId),
    [['agent', agentId], ['agent-turns', agentId]],
  );
}

export function useClearQueue(agentId: string) {
  return useInvalidatingMutation(
    () => client.clearQueue(agentId),
    [['agent', agentId]],
  );
}

export function useRenameAgent(agentId: string) {
  return useInvalidatingMutation(
    (title: string) => client.rename(agentId, { title }),
    [['agents'], ['agent', agentId]],
  );
}

export function useRemoveAgent(agentId: string) {
  return useInvalidatingMutation(
    () => client.remove(agentId),
    [['agents'], ['agent', agentId], ['agent-turns', agentId]],
  );
}
