/** 真实文件与命令验证失败能反馈给模型，修复后重新检查；不伪造通过结果。 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createArcher } from '@archer/runtime';
import { testCamp } from '../helpers/application';
import { toolReply } from '../helpers/inference';
it('写入、验证失败、修复、重新验证通过，然后完成；失败命令保留确定结果', async () => {
  const root = await mkdtemp(join(tmpdir(), 'archer-verification-'));
  await writeFile(join(root, 'sum.cjs'), 'module.exports = (a, b) => a - b;\n');
  const command = `node -e "const assert=require('node:assert/strict'); assert.equal(require('./sum.cjs')(2,3),5)"`;
  let step = 0;
  const archer = createArcher({ camp: testCamp({ inference: { infer: async effect => {
    switch (step++) {
      case 0: return toolReply(effect, 'files.write', { path: 'sum.cjs', content: 'module.exports = (a, b) => a * b;\n' });
      case 1: return toolReply(effect, 'shell.bash', { command });
      case 2:
        expect(effect.messages.at(-1)).toMatchObject({ role: 'tool', isError: true, content: expect.stringContaining('[exit code 1]') });
        expect(effect.messages.at(-1)!.content).toContain('AssertionError');
        return toolReply(effect, 'files.edit', { path: 'sum.cjs', old_string: 'a * b', new_string: 'a + b' });
      case 3: return toolReply(effect, 'shell.bash', { command });
      default:
        expect(effect.messages.filter(message => message.role === 'tool').at(-1)?.isError).not.toBe(true);
        expect(effect.messages.filter(message => message.role === 'tool').at(-1)?.content).toContain('[exit code 0]');
        return { content: 'Fixed addition. The assertion passed after the repair.', stopReason: 'stop' };
    }
  } } }) });
  try {
    await archer.start(); const agent = await archer.agents.create({ id: 'verification', instructions: 'Fix addition and verify it.', workspace: { cwd: root, access: 'edit' } });
    await agent.prompt('Fix addition.', { allowShell: true, commandMode: 'full' });
    expect(await readFile(join(root, 'sum.cjs'), 'utf8')).toBe('module.exports = (a, b) => a + b;\n'); expect(step).toBe(6);
    const events = await agent.events();
    const commands = events.flatMap(item => item.fact.scope === 'turn' && item.fact.event.type === 'effect.completed' && item.fact.event.data.effectType === 'CALL'
      && typeof item.fact.event.data.result.value === 'object' && item.fact.event.data.result.value !== null && 'metadata' in item.fact.event.data.result.value
      && JSON.stringify(item.fact.event.data.result.value).includes('"exitCode"') ? [item.fact.event.data.result] : []);
    expect(commands).toHaveLength(2); expect(commands[0]!.isError).toBe(true); expect(commands[1]!.isError).not.toBe(true);
    expect(events.some(item => item.fact.event.type === 'effect.unknown')).toBe(false);
    expect(events.filter(item => item.fact.event.type === 'completion.review.requested')).toHaveLength(1);
    expect(events.at(-1)?.fact.event.type).toBe('turn.completed');
  } finally { await archer.stop(); await rm(root, { recursive: true, force: true }); }
});
