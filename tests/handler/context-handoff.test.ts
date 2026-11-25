/** 引文和结果分类是机械校验，不把模型文字当作事实证明。 */
import { expect, it } from 'vitest';
import { validateContextHandoff, type Message } from '@archer/contracts';
import { executionReference, validateCompaction, type ExecutionFact } from '@archer/handler';
const source: Message[] = [{ role: 'user', content: 'Do not change public API.' }, { role: 'tool', content: 'Compilation failed: missing symbol', isError: true, toolCallId: 'read' }];
function handoff() {
  return { version: 2, findings: [{ text: 'Compilation failed.', evidence: [{ messageIndex: 1, quote: 'missing symbol', toolOutcome: 'tool-error' }] }], hypotheses: [], rejectedApproaches: [], decisions: [], blockers: [], nextActions: [{ action: 'Inspect the definition before editing.', preconditions: ['Read the current file revision.'], rereadEvidence: [{ messageIndex: 1, quote: 'missing symbol' }] }] };
}
it('允许绑定原始证据的发现，拒绝超范围、伪造引文和结果冲突', () => {
  const valid = handoff();
  expect(validateContextHandoff(JSON.stringify(valid), source).findings).toHaveLength(1);
  for (const evidence of [
    { messageIndex: 2, quote: 'missing symbol' },
    { messageIndex: 1, quote: 'All tests passed' },
    { messageIndex: 1, quote: 'missing symbol', toolOutcome: 'completed' },
    { messageIndex: 0, quote: 'public API', toolOutcome: 'completed' },
  ]) expect(() => validateCompaction({ content: JSON.stringify({ ...valid, findings: [{ text: 'Claim.', evidence: [evidence] }] }) }, source)).toThrow('Invalid structured handoff');
});
it('普通文字、空交接、缺少证据与截断输出不能采用', () => {
  const valid = handoff();
  for (const content of ['Free text summary.', JSON.stringify({ ...valid, findings: [], nextActions: [] }), JSON.stringify({ ...valid, findings: [{ text: 'All done.', evidence: [] }] })]) {
    expect(() => validateCompaction({ content }, source)).toThrow();
  }
  expect(() => validateCompaction({ content: JSON.stringify(valid), stopReason: 'length' }, source)).toThrow();
});
it('事实参考优先保留未知与放弃追踪，标明有界遗漏，不猜测操作成功', () => {
  const facts: ExecutionFact[] = Array.from({ length: 45 }, (_, index) => ({ turnId: 't', effectId: `e${index}`, callId: `c${index}`, status: index < 4 ? 'unknown' : 'completed', abandoned: index === 0 }));
  const reference = executionReference(facts)!;
  const data = JSON.parse(reference.content.split('\n')[1]!);
  expect(data.records).toHaveLength(32);
  expect(data.omitted).toBe(13);
  expect(data.omittedUnresolved).toBe(0);
  expect(data.records).toContainEqual(expect.objectContaining({ effectId: 'e0', status: 'unknown', abandoned: true }));
  expect(() => executionReference(facts.map(fact => ({ ...fact, status: 'unknown', toolName: 'x'.repeat(1000) })))).toThrow('unresolved operations');
});

it('行动重读引用同样绑定原文，前提字段不能省略或退回字符串', () => {
  const valid = handoff();
  const action = valid.nextActions[0]!;
  for (const nextActions of [
    ['Read first.'],
    [{ action: 'Read first.', rereadEvidence: [] }],
    [{ ...action, rereadEvidence: [{ messageIndex: 9, quote: 'missing symbol' }] }],
    [{ ...action, rereadEvidence: [{ messageIndex: 1, quote: 'All passed' }] }],
  ]) expect(() => validateContextHandoff(JSON.stringify({ ...valid, nextActions }), source)).toThrow();
  expect(validateContextHandoff(JSON.stringify(valid), source).nextActions[0]!.preconditions).toEqual(['Read the current file revision.']);
});
it('拒绝混用旧版错误分类及结构，明确无交接不能作为已采用摘要', () => {
  const valid = handoff();
  expect(() => validateContextHandoff(JSON.stringify({ ...valid, version: 1 }), source)).toThrow();
  expect(() => validateContextHandoff(JSON.stringify({ ...valid, findings: [{ text: 'Failure', evidence: [{ messageIndex: 1, quote: 'missing symbol', toolOutcome: 'business-error' }] }] }), source)).toThrow();
  expect(() => validateCompaction({ content: JSON.stringify({ version: 2, kind: 'no-handoff', reason: 'insufficient-evidence' }) }, source)).toThrow('No usable handoff');
});

it('区分引文开销、重复引用和字符占比，不据此推断任务质量', async () => {
  const { measureHandoffEvidence } = await import('@archer/handler');
  const source: Message[] = [{ role: 'tool', content: 'x'.repeat(512) }];
  const measure = (length: number) => {
    const value = { ...handoff(), findings: Array.from({ length: 16 }, (_, index) => ({ text: `Finding ${index}`, evidence: [{ messageIndex: 0, quote: 'x'.repeat(length) }] })), nextActions: [] };
    const content = JSON.stringify(value);
    return measureHandoffEvidence(validateContextHandoff(content, source), content);
  };
  const long = measure(512); const short = measure(32);
  expect(long).toMatchObject({ quoteChars: 8192, uniqueQuoteChars: 512, evidenceReferences: 16 });
  expect(short).toMatchObject({ quoteChars: 512, uniqueQuoteChars: 32, evidenceReferences: 16 });
  expect(long.quoteCharShare).toBeGreaterThan(0.6);
  expect(short.quoteCharShare).toBeLessThan(0.4);
  expect(short.responseChars).toBeLessThan(long.responseChars);
});

it('剥离模型偶发附带的 Markdown JSON 围栏后仍严格校验结构与引文', () => {
  const fenced = `\`\`\`json\n${JSON.stringify(handoff())}\n\`\`\``;
  expect(validateContextHandoff(fenced, source).findings).toHaveLength(1);
});
