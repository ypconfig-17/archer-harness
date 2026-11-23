import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentEvent, Snapshot } from '@archer/contracts';
import { useAgentStreamStore } from '../../../apps/desktop/renderer/src/store/agent-stream.js';

const event = (seq: number) => ({ seq } as Snapshot<AgentEvent>);

beforeEach(() => useAgentStreamStore.getState().clear('performance-test'));

describe('事件缓存增量合并', () => {
  it('按序追加，并在历史补齐与重连重叠时保持有序且去重', () => {
    const append = (events: Snapshot<AgentEvent>[]) => useAgentStreamStore.getState().appendEvents('performance-test', events);
    append([event(3), event(4)]);
    append([event(5), event(5), event(6)]);
    append([event(2), event(1), event(3)]);
    expect(useAgentStreamStore.getState().eventsByAgent['performance-test']?.map(item => item.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('空增量与重复引用不会通知订阅者，替换事实仍会发布', () => {
    const store = useAgentStreamStore;
    const original = event(1);
    store.getState().appendEvents('performance-test', [original]);
    let notifications = 0;
    const unsubscribe = store.subscribe(() => notifications++);
    try {
      store.getState().appendEvents('performance-test', []);
      store.getState().appendEvents('performance-test', [original]);
      expect(notifications).toBe(0);
      const replacement = event(1);
      store.getState().appendEvents('performance-test', [replacement]);
      expect(notifications).toBe(1);
      expect(store.getState().eventsByAgent['performance-test']?.[0]).toBe(replacement);
    } finally {
      unsubscribe();
    }
  });
});
