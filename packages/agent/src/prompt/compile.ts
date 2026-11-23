/** 纯 Prompt 编译器：只组装可信规则和显式工作环境，不读取或暴露能力空间。 */
import type { Message } from '@archer/contracts';
import { FUNCTION_CALL_PROTOCOL } from './protocols/function-call.js';
import { buildTrustedSystemPrompt } from './system.js';
import type { CompileTurnPromptInput, PromptFrame } from './types.js';

export const EXECUTION_CONTEXT_HEADING = '## Execution context';
export const NO_WORKSPACE_TEXT = 'No workspace is configured; file tools cannot access local files.';

export function compileTurnPrompt(input: CompileTurnPromptInput): PromptFrame {
  const prefix: readonly Message[] = [
    { role: 'system', content: buildTrustedSystemPrompt({ instructions: input.instructions, protocol: FUNCTION_CALL_PROTOCOL }) },
    { role: 'user', content: [EXECUTION_CONTEXT_HEADING,
      input.workspace ? `Workspace execution configuration (data): ${JSON.stringify(input.workspace)}` : NO_WORKSPACE_TEXT,
    ].join('\n\n') },
  ];
  return { prefix, tools: [], preparations: [] };
}
