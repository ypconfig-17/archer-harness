/** 临时进度仅在页面内缓存，不能用于恢复执行或构造正式消息。 */
import { create } from 'zustand';
import type { InferenceProgress, Snapshot } from '@archer/contracts';
interface ProgressState {
  frames: Record<string, Record<string, Snapshot<InferenceProgress>>>;
  update(...frames: Snapshot<InferenceProgress>[]): void;
  /** 离开会话即丢弃该 Agent 的临时流；已提交结果是唯一可恢复来源。 */
  release(agentId: string): void;
}
export const useProgress = create<ProgressState>(set => ({
  frames: {},
  // 一次绘制内的多份累计快照只提交一次状态，避免同步订阅者阻塞 SSE 的继续读取。
  update: (...incoming) => set(state => {
    const frames = { ...state.frames };
    for (const frame of incoming) {
      frames[frame.agentId] = { ...frames[frame.agentId], [frame.effectId]: frame };
    }
    return { frames };
  }),
  release: agentId => set(state => {
    if (state.frames[agentId] === undefined) return state;
    const frames = { ...state.frames };
    delete frames[agentId];
    return { frames };
  }),
}));
