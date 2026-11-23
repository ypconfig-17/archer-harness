/** 文件工具与任务交互由一个普通 Provider 提供，工作环境由 Runtime 显式注入。 */
import { provider, tool } from '@archer/camp';
import { OperationRejected } from '@archer/contracts';
import { createToolSpecs } from './tools/index.js';
import { committedPlans, planResult } from './tools/plan.js';
import { TOOL_PLAN_DESCRIPTION, TOOL_PLAN_SUMMARY, TOOL_PLAN_SCHEMA, ASK_DESCRIPTION, ASK_SUMMARY, ASK_INPUT_SCHEMA, TOOL_WORKSPACE_REQUIRED, TOOL_HUMAN_RUNTIME_REQUIRED } from './tools/prompt.js';
export function toolsProvider() {
  return provider('files', {
    ...Object.fromEntries(createToolSpecs().map(spec => [spec.name, tool({
      description: spec.docs, summary: spec.summary, inputSchema: spec.schema, execution: spec.mutating ? 'write' : 'read', resultView: 'output',
      invoke: async (input, context) => {
        if (!context.files) throw new OperationRejected(TOOL_WORKSPACE_REQUIRED, 'PERMISSION_DENIED');
        const result = await spec.execute({ files: context.files, signal: context.signal }, input);
        return { output: result.output, ...(result.metadata ? { metadata: result.metadata } : {}) };
      },
    })])),
    plan: tool({ description: TOOL_PLAN_DESCRIPTION, summary: TOOL_PLAN_SUMMARY, inputSchema: TOOL_PLAN_SCHEMA, execution: 'read', invoke: async (input, context) => planResult(input, committedPlans(context)) }),
    ask: tool({ description: ASK_DESCRIPTION, summary: ASK_SUMMARY, inputSchema: ASK_INPUT_SCHEMA, execution: 'read', interaction: 'human',
      invoke: async () => { throw new Error(TOOL_HUMAN_RUNTIME_REQUIRED); } }),
  }, { identity: { implementation: 'workspace-tools', revision: 2 } });
}
