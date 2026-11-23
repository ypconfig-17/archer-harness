/** 模型通过原生工具调用表达执行意图，普通文本作为最终回复。 */
export const FUNCTION_CALL_PROTOCOL = `## Tool calling protocol

Use the provided function tools to request operations.
Do not emit JSON action plans or claim an operation succeeded before receiving its tool result.

Use only function names provided in this request and arguments matching their schemas.
Do not invent tools or request an internal capability catalog.

Use the provided plan declaration tool to publish and update task stages following the system rules.
Submit the complete stage list on each update, then continue the authorized work.
Do not replace a tool declaration with a prose-only checklist.

Operations execute sequentially.
A nonzero command exit is a known unsuccessful result: inspect its diagnostics, make a targeted
correction when authorized, and rerun the relevant check.
Report passed, failed, and unperformed checks separately.
A result may be unknown; never retry an uncertain operation without explicit host reconciliation.

If work remains and tools are needed, include any useful user-facing progress text together with
the necessary tool calls in the same response. A text-only response ends the turn; do not use it
only to announce that you will continue working. Progress text is optional, not required before
each tool call.

When the task is complete or no tool is needed, answer the user in ordinary text, following the
user's language.`;

/** 非法批次不能形成原生工具消息时，改用观察反馈，不伪造调用身份。 */
export const TOOL_BATCH_REJECTION_LABEL = 'tool call batch rejected';
export const COMPLETION_REVIEW_LABEL = 'completion review';
export const COMPLETION_REVIEW_NOTICE = `Files were changed during this task.
Before finishing, review the requested outcome and the actual tool results.
Run relevant existing checks when authorized; if a check fails, investigate and repair it, then
rerun it.
If verification is unavailable, prohibited, or still failing, explain the concrete blocker and
remaining uncertainty.
Report what changed, which checks ran, and their actual outcomes.
Do not treat any successful command as proof of the whole task, invent verification, or repeat an
operation with an unknown outcome.`;
export const EMPTY_RESPONSE_LABEL = 'empty inference response';
export const EMPTY_RESPONSE_NOTICE = `No answer or tool call was returned.
Continue the requested work using the available tools, or provide a substantive answer.
If blocked, explain the concrete blocker and what remains incomplete.`;

/** 拒绝原因属于模型输出的诊断数据。 */
export function formatToolCallRejection(reason: string, toolNames: readonly string[]): string {
  return [
    `Tool call rejected: ${reason}.`,
    `Available function names for this request: ${JSON.stringify(toolNames)}.`,
    'Correct the call using only function names and argument schemas provided in this request.',
  ].join('\n');
}

/** 整批未执行，原始调用保留在推理事实中，不转发非法消息结构。 */
export function formatToolBatchRejection(reasons: readonly string[], toolNames: readonly string[]): string {
  return [
    'No tool calls from this response were executed.',
    `Available function names for this request: ${JSON.stringify(toolNames)}.`,
    `Invalid tool message structure: ${JSON.stringify(reasons)}.`,
    'Submit a corrected request using unique call IDs and JSON object arguments.',
  ].join('\n');
}
