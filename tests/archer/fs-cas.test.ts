import { testCamp } from '../helpers/application';
import { toolReply } from '../helpers/inference';
/** 不同 Agent 经共享文件工具，在同源工作环境后端的受控边界内竞争版本。 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createArcher } from '@archer/runtime';
import { MemoryAgentJournal } from '@archer/storage';
import { LocalFilesystem } from '@archer/providers';

it('同源工作环境下，两 Agent 使用同一 revision 更新文件时只有一个成功', async () => {
  const root = await mkdtemp(join(tmpdir(), 'archer-agent-cas-'));
  await writeFile(join(root, 'note.txt'), 'original');
  const initial = await new LocalFilesystem(root).stat('note.txt');
  const expectedRevision = initial!.revision;
  const archer = createArcher({
    camp: testCamp({ journal: new MemoryAgentJournal(),
      inference: { infer: async (effect) => {
      const direct = effect.messages.some((message) => message.role === 'user' && message.content === 'direct');
      const writer = effect.tools?.find(tool => tool.target.providerId + '.' + tool.target.capabilityId === 'files.write');
      if (writer && effect.messages.some(message => message.role === 'tool' && message.toolName === writer.name)) return { content: 'Attempted update.' };
      return toolReply(effect, 'files.write', { path: 'note.txt', content: direct ? 'direct update' : 'tool update', expectedRevision });
    } } }),

  });
  try {
    await archer.start();
    const direct = await archer.agents.create({ id: 'direct', instructions: 'Update with the supplied revision.', workspace: { cwd: root, access: 'edit' } });
    const tool = await archer.agents.create({ id: 'tool', instructions: 'Update with the supplied revision.', workspace: { cwd: root, access: 'edit' } });
    await Promise.all([direct.prompt('direct'), tool.prompt('tool')]);

    const histories = await Promise.all([direct, tool].map(async (agent) => {
      const [turn] = await agent.turns.list();
      expect(turn!.status).toBe('completed');
      return agent.turns.events(turn!.turnId);
    }));
    const results = histories.flatMap(events => events.filter(event =>
      (event.type === 'effect.completed' || event.type === 'effect.failed') && event.data.effectType === 'CALL'
      && events.some(created => created.type === 'effect.created' && created.data.effectId === event.data.effectId && created.data.effect.type === 'CALL' && created.data.effect.target.providerId + '.' + created.data.effect.target.capabilityId === 'files.write')));
    expect(results).toHaveLength(2);
    expect(results.filter(event => event.type === 'effect.completed')).toHaveLength(1);
    expect(results.find(event => event.type === 'effect.failed')).toMatchObject({ data: { error: { code: 'REVISION_CONFLICT' } } });
    expect(['direct update', 'tool update']).toContain(await readFile(join(root, 'note.txt'), 'utf8'));
  } finally {
    await archer.stop();
    await rm(root, { recursive: true, force: true });
  }
});
