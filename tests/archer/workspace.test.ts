import { testCamp } from '../helpers/application';
/** 工作环境独立于能力树；共享工具保持 Agent 隔离和可回放配置。 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { type Archer } from '@archer/contracts';
import { createArcher } from '@archer/runtime';
import { MemoryAgentJournal } from '@archer/storage';
import { toolReply } from '../helpers/inference';

const roots: string[] = [];
const archers: Archer[] = [];
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'archer-environment-'));
  roots.push(root);
  return root;
}
const storage = () => new MemoryAgentJournal();

afterEach(async () => {
  for (const archer of archers.splice(0).reverse()) await archer.stop();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

it('两个 Agent 共享工具但读取各自目录', async () => {
  const first = await directory();
  const second = await directory();
  await writeFile(join(first, 'note.txt'), 'first workspace');
  await writeFile(join(second, 'note.txt'), 'second workspace');
  const archer = createArcher({
    camp: testCamp({ journal: storage(),
      inference: { infer: async effect => {
    const reader = effect.tools?.find(tool => tool.target.providerId + '.' + tool.target.capabilityId === 'files.read');
    if (reader && effect.messages.some(message => message.role === 'tool' && message.toolName === reader.name)) return { content: 'done' };
    return toolReply(effect, 'files.read', { path: 'note.txt' });
  } } }),

  });
  archers.push(archer);
  await archer.start();
  const agents = await Promise.all([first, second].map((cwd, index) => archer.agents.create({
    id: `reader-${index}`, instructions: 'Read the note.', workspace: { cwd, access: 'read' },
  })));
  await Promise.all(agents.map(agent => agent.prompt('Read.')));
  for (const [index, agent] of agents.entries()) {
    const state = await agent.getState();
    expect(state.messages.map(message => message.content).join('\n')).toContain(index === 0 ? 'first workspace' : 'second workspace');
    expect(state.messages.map(message => message.content).join('\n')).not.toContain(index === 0 ? 'second workspace' : 'first workspace');
  }
});

it('工作环境访问调整通过执行配置提交，重启后恢复配置', async () => {
  const cwd = await directory();
  const facts = storage();
  const options = { camp: testCamp({ journal: facts, inference: { infer: async () => ({ content: 'done' }) } }) };
  const first = createArcher(options);
  archers.push(first);
  await first.start();
  const agent = await first.agents.create({ id: 'persisted', instructions: 'Work.', workspace: { cwd, access: 'read' } });
  await first.agents.configureExecution(agent.id, { expectedRevision: 0, workspaceAccess: 'edit' });
  await expect(first.agents.configureExecution(agent.id, { expectedRevision: 0, workspaceAccess: 'read' })).rejects.toMatchObject({ code: 'CONFLICT' });
  expect((await agent.getState()).workspace).toEqual({ cwd, access: 'edit' });
  await first.stop();
  const second = createArcher(options);
  archers.push(second);
  await second.start();
  const restored = await second.agents.get(agent.id);
  expect((await restored!.getState()).workspace).toEqual({ cwd, access: 'edit' });
});

it('工作目录显式校验且参与创建幂等身份', async () => {
  const cwd = await directory();
  const other = await directory();
  const archer = createArcher({
    camp: testCamp({ journal: storage(),
      inference: { infer: async () => ({ content: 'done' }) } }),

  });
  archers.push(archer);
  await archer.start();
  const declaration = { id: 'configured', instructions: 'Work.' };
  await expect(archer.agents.create({ ...declaration, workspace: { cwd: '.', access: 'read' } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  await expect(archer.agents.create({ ...declaration, workspace: { cwd: join(cwd, 'missing'), access: 'read' } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  await archer.agents.create({ ...declaration, workspace: { cwd, access: 'read' } });
  await expect(archer.agents.create({ ...declaration, workspace: { cwd: other, access: 'read' } })).rejects.toMatchObject({ code: 'CONFLICT' });
});

it('缺少工作环境时文件工具明确拒绝，不回退到服务进程目录', async () => {
  const cwd = await directory();
  await writeFile(join(cwd, 'untouched.txt'), 'original');
  const archer = createArcher({
    camp: testCamp({ journal: storage(),
      inference: { infer: async effect => {
    const writer = effect.tools?.find(tool => tool.target.providerId + '.' + tool.target.capabilityId === 'files.write');
    if (writer && effect.messages.some(message => message.role === 'tool' && message.toolName === writer.name)) return { content: 'done' };
    return toolReply(effect, 'files.write', { path: join(cwd, 'untouched.txt'), content: 'changed' });
  } } }),

  });
  archers.push(archer);
  await archer.start();
  const agent = await archer.agents.create({ id: 'no-workspace', instructions: 'Work.' });
  await agent.prompt('Write.');
  expect((await agent.getState()).messages.some(message => message.role === 'tool' && message.isError && message.content.includes('explicitly configured agent workspace'))).toBe(true);
  expect(await readFile(join(cwd, 'untouched.txt'), 'utf8')).toBe('original');
});
