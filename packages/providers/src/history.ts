/** 历史读取通过普通工具能力装配，端口由 Runtime 绑定当前 Agent。 */
import { provider, tool } from '@archer/camp';
import { HistoryReadInputSchema, OperationRejected } from '@archer/contracts';
import { HISTORY_READ_DESCRIPTION, HISTORY_READ_SCHEMA, HISTORY_READ_SUMMARY } from './tools/prompt.js';
export function historyProvider() {
  return provider('history', { read: tool({
    description: HISTORY_READ_DESCRIPTION, summary: HISTORY_READ_SUMMARY, inputSchema: HISTORY_READ_SCHEMA, execution: 'read',
    invoke: (input, context) => {
      if (!context.history) throw new OperationRejected('History reader is unavailable.', 'CAPABILITY_UNAVAILABLE');
      return { ...context.history.read(HistoryReadInputSchema.parse(input)) };
    },
  }) }, { identity: { implementation: 'committed-history', revision: 1 } });
}
