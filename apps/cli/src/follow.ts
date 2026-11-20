/**
 * Archer Harness CLI — 跟踪 Turn 直到终态
 *
 * Turn 事件流按 turnSeq 升序回放并在终止事实后结束。
 */

import type { Agent, TurnStatus } from '@archer/contracts';
import { renderTurnEvent } from './format.js';

export interface FollowOptions {
  json?: boolean;
}

export async function followTurn(
  agent: Agent,
  turnId: string,
  options: FollowOptions = {},
): Promise<TurnStatus> {
  const json = options.json === true;
  for await (const event of agent.turns.watch(turnId, { afterSeq: 0 })) {
    renderTurnEvent(event, json);
  }
  const turn = await agent.turns.get(turnId);
  if (!turn) throw new Error(`Turn 不存在：${turnId}`);
  return turn.status;
}
