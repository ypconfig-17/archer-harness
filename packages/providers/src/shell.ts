/** Shell 工具的目录来自当前 Agent 工作环境，不捕获全局项目目录。 */
import { createHash } from 'node:crypto';
import { provider, tool } from '@archer/camp';
import { OperationRejected } from '@archer/contracts';
import { ShellProvider, type ShellProviderOptions } from './shell-provider.js';
import { SHELL_ROOT_DESCRIPTION, SHELL_SCHEMA, SHELL_SUMMARY } from './tools/prompt.js';
export function shellProvider(options: ShellProviderOptions = {}) {
  const environment = Object.fromEntries(Object.entries(options.env ?? {}).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)));
  const environmentRevision = createHash('sha256').update(JSON.stringify(environment)).digest('hex');
  return provider('shell', { bash: tool({
    description: SHELL_ROOT_DESCRIPTION, summary: SHELL_SUMMARY, inputSchema: SHELL_SCHEMA, execution: 'shell', resultView: 'output',
    invoke: async (input, context) => {
      if (!context.workspace) throw new OperationRejected('Shell requires an explicitly configured workspace.', 'PERMISSION_DENIED');
      return new ShellProvider(context.workspace.cwd, options).execute(input, context.signal);
    },
  }) }, { identity: { implementation: 'host-shell', revision: 2, environmentRevision, timeoutMs: options.timeoutMs ?? 30_000, maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024 } });
}
