/** V2 操作投影：验证 CALL_BATCH 并发只读批次与 subagent delegate 卡片投影与状态。 */
import { describe, expect, it } from 'vitest';
import {
  operationCategory,
  operationDisplay,
  operationState,
  operationSummary,
} from '../../../apps/desktop/renderer/src/lib/operation';
import type { EffectEntry } from '../../../apps/desktop/renderer/src/lib/conversation';

const readRef = {
  providerId: 'fs',
  capabilityId: 'read',
  contractId: 'archer.tool@1',
  revision: 'r1',
};

describe('桌面端 V2 操作投影', () => {
  it('CALL_BATCH 正确投影标题、目标、只读分类及部分失败状态', () => {
    const entry: EffectEntry = {
      effectId: 'e1',
      turnId: 'a:t1',
      createdAt: 1,
      attempt: 1,
      effectType: 'CALL_BATCH',
      effect: {
        type: 'CALL_BATCH',
        calls: [
          { target: readRef, input: { path: 'src/a.ts' }, toolCallId: 'c1', toolName: 'fs_read' },
          { target: readRef, input: { path: 'src/b.ts' }, toolCallId: 'c2', toolName: 'fs_read' },
          { target: readRef, input: { path: 'src/c.ts' }, toolCallId: 'c3', toolName: 'fs_read' },
          { target: readRef, input: { path: 'src/d.ts' }, toolCallId: 'c4', toolName: 'fs_read' },
        ],
      },
      end: {
        id: 'a:10',
        agentId: 'a',
        seq: 10,
        ts: 10,
        fact: {
          scope: 'turn',
          turnId: 'a:t1',
          turnSeq: 5,
          event: {
            type: 'effect.completed',
            data: {
              effectId: 'e1',
              effectType: 'CALL_BATCH',
              durationMs: 25,
              finishedAt: 10,
              result: {
                results: [
                  { status: 'completed', result: { value: 'ok' } },
                  { status: 'failed', error: { code: 'NOT_FOUND', message: 'missing b.ts' } },
                  { status: 'completed', result: { value: 'ok' } },
                  { status: 'completed', result: { value: 'ok' } },
                ],
              },
            },
          },
        },
      }.fact.event,
    };

    expect(operationCategory(entry)).toBe('read');
    expect(operationSummary(entry)).toEqual({
      title: '并发只读调用',
      target: 'src/a.ts、src/b.ts、src/c.ts 等 4 项',
      detail: '共 4 项',
    });
    expect(operationDisplay(entry).icon).toBe('search');
    expect(operationState(entry)).toEqual({
      label: '部分失败（1/4）',
      tone: 'error',
    });
  });

  it('subagent delegate 正确投影任务描述与子会话标识', () => {
    const entry: EffectEntry = {
      effectId: 'e2',
      turnId: 'a:t1',
      createdAt: 1,
      attempt: 1,
      effectType: 'CALL',
      effect: {
        type: 'CALL',
        target: {
          providerId: 'subagent',
          capabilityId: 'delegate',
          contractId: 'archer.tool@1',
          revision: 'r1',
        },
        input: { task: '检查测试覆盖率' },
        toolCallId: 'd1',
        toolName: 'subagent_delegate',
      },
      end: {
        scope: 'turn',
        turnId: 'a:t1',
        turnSeq: 6,
        event: {
          type: 'effect.completed',
          data: {
            effectId: 'e2',
            effectType: 'CALL',
            durationMs: 120,
            finishedAt: 120,
            result: {
              value: { agentId: 'a-t1-sub-1', output: '覆盖率正常' },
            },
          },
        },
      }.event,
    };

    expect(operationSummary(entry)).toEqual({
      title: '子 Agent 任务',
      target: '检查测试覆盖率',
      detail: '子会话 a-t1-sub-1',
    });
    expect(operationDisplay(entry).icon).toBe('spark');
  });
});
