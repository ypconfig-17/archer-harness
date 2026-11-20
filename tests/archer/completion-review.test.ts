/** 文件修改后的结束复核由事实驱动，不能静默接受第一次交差或无限追问。 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createArcher } from '@archer/runtime';
import { MemoryAgentJournal } from '@archer/storage';
import { replayAgent } from '@archer/agent';
import { testCamp } from '../helpers/application';
import { toolReply } from '../helpers/inference';
it('文件写入后的首次交差转入复核，无命令授权时可如实说明未验证原因', async () => {
  const root = await mkdtemp(join(tmpdir(), 'archer-completion-review-')); const journal = new MemoryAgentJournal(); let steps = 0;
  const archer = createArcher({ camp: testCamp({ journal, inference: { infer: async effect => {
    switch (steps++) {
      case 0: return toolReply(effect, 'files.write', { path: 'README.md', content: '# Updated\n' });
      case 1: return { content: 'Everything is verified.' };
      default:
        expect(effect.messages.at(-1)?.content).toContain('[completion review]');
        expect(effect.messages.some(message => message.role === 'assistant' && message.content === 'Everything is verified.')).toBe(false);
        return { content: 'Updated README. Command checks were not run because this turn has no Shell authorization.' };
    }
  } } }) });
  try {
    await archer.start(); const agent = await archer.agents.create({ id: 'review', instructions: 'Update documentation.', workspace: { cwd: root, access: 'edit' } });
    await agent.prompt('Update README.', { allowShell: false }); expect(steps).toBe(3); expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('# Updated\n');
    const events = await journal.read(agent.id); expect(events.filter(item => item.fact.event.type === 'completion.review.requested')).toHaveLength(1);
    const restored = replayAgent(agent.id, events)!; expect(restored.messages).toEqual((await agent.getState()).messages);
    expect(restored.turns.values().next().value?.completionReviewAfter).toBeDefined();
    expect((await agent.getState()).messages.at(-1)?.content).toContain('were not run');
  } finally { await archer.stop(); await rm(root, { recursive: true, force: true }); }
});
it('复核后再次修改文件会建立新的复核边界，同一边界不重复询问', async () => {
  const root = await mkdtemp(join(tmpdir(), 'archer-completion-review-')); let steps = 0;
  const archer = createArcher({ camp: testCamp({ inference: { infer: async effect => {
    switch (steps++) {
      case 0: return toolReply(effect, 'files.write', { path: 'README.md', content: 'First.' });
      case 1: return { content: 'Done.' };
      case 2: return toolReply(effect, 'files.edit', { path: 'README.md', old_string: 'First.', new_string: 'Final.' });
      case 3: return { content: 'Done again.' };
      default: return { content: 'Updated documentation. No automated check was performed.' };
    }
  } } }) });
  try {
    await archer.start(); const agent = await archer.agents.create({ id: 'review-again', instructions: 'Update documentation.', workspace: { cwd: root, access: 'edit' } });
    await agent.prompt('Update README.'); expect(steps).toBe(5);
    const boundaries = (await agent.events()).flatMap(item => item.fact.scope === 'turn' && item.fact.event.type === 'completion.review.requested' ? [item.fact.event.data.afterEffectId] : []);
    expect(new Set(boundaries).size).toBe(2); expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('Final.');
  } finally { await archer.stop(); await rm(root, { recursive: true, force: true }); }
});
