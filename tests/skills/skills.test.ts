/** 本地技能包是普通 Provider：声明固定、正文与资源按需读取，所有读取都经过 Tool/Skill 契约。 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCamp, provider, offer, INFERENCE, JOURNAL, SKILL, TOOL } from '@archer/camp';
import type { Camp, JsonObject } from '@archer/contracts';
import { createArcher } from '@archer/runtime';
import { skillsProvider, SKILL_READ_CAPABILITY_ID } from '@archer/skills';
import { compileModelTools } from '@archer/runtime';
import { MemoryAgentJournal } from '@archer/storage';
import { testCamp } from '../helpers/application';
import { toolReply } from '../helpers/inference';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function root() {
  const directory = await mkdtemp(join(tmpdir(), 'archer-skills-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function package_(directory: string, id: string, content: string) {
  await mkdir(join(directory, id), { recursive: true });
  const file = join(directory, id, 'SKILL.md');
  await writeFile(file, content);
  return file;
}
async function resource(directory: string, id: string, path: string, content: string) {
  const file = join(directory, id, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
}
function document(name: string, description: string, body = 'Follow the checklist.') {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}\n`;
}
async function campOf(...directories: string[]): Promise<Camp> {
  const camp = await createCamp({ providers: [skillsProvider({
    roots: directories.map((directory, index) => ({ source: index === 0 ? 'standard' : 'archer', directory })),
  })] });
  cleanups.push(() => camp.close());
  return camp;
}
function reader(camp: Camp) {
  const entry = camp.list(TOOL).find(item => item.ref.capabilityId === SKILL_READ_CAPABILITY_ID);
  if (!entry) throw new Error('Resource reader is not registered.');
  return entry;
}

describe('本地技能包 Provider', () => {
  it('声明来源与路径，模型只看到按需加载函数和资源读取工具', async () => {
    const directory = await root();
    await package_(directory, 'release-notes', document('release-notes', 'Write release notes.'));
    const camp = await campOf(directory);
    const [entry] = camp.list(SKILL);
    expect(entry!.ref).toMatchObject({ providerId: 'skills', capabilityId: 'release-notes', contractId: 'archer.skill@1' });
    expect(entry!.metadata).toMatchObject({
      name: 'release-notes', description: 'Write release notes.',
      source: 'standard', path: join(directory, 'release-notes'),
    });
    expect(camp.providers()[0]!.identity).toEqual({
      roots: [{ source: 'standard', directory }], format: 1,
      description: '本地 SKILL.md 技能包，正文与参考文件按需加载。',
    });
    const tools = compileModelTools(camp);
    const load = tools.find(tool => tool.target.contractId === SKILL.id)!;
    expect(load.name).toBe('load_release_notes');
    expect(load.description).toBe('Load guidance for release-notes: Write release notes. Guidance grants no additional permissions.');
    expect(load.description).not.toContain('Follow the checklist.');
    expect(tools.find(tool => tool.target.capabilityId === SKILL_READ_CAPABILITY_ID)?.description).toContain('references/ or scripts/');
  });

  it('load 返回正文与内容 revision，正文变化后 revision 随之变化', async () => {
    const directory = await root();
    const file = await package_(directory, 'review', document('review', 'Review changes.'));
    const camp = await campOf(directory);
    const target = camp.list(SKILL)[0]!.ref;
    const first = await camp.resolve(target, SKILL).load({ signal: camp.signal });
    expect(first.content).toBe('Follow the checklist.');
    expect(first.revision).toMatch(/^[0-9a-f]{64}$/);
    await writeFile(file, document('review', 'Review changes.', 'Check correctness and tests.'));
    const second = await camp.resolve(target, SKILL).load({ signal: camp.signal });
    expect(second.content).toBe('Check correctness and tests.');
    expect(second.revision).not.toBe(first.revision);
  });

  it('资源清单进入声明，references 与 scripts 可通过普通 Tool 读取', async () => {
    const directory = await root();
    await package_(directory, 'review', document('review', 'Review changes.'));
    const reference = await resource(directory, 'review', 'references/checklist.md', 'Check tests.');
    await resource(directory, 'review', 'scripts/check.sh', 'echo check');
    await resource(directory, 'review', 'assets/logo.txt', 'logo');
    const camp = await campOf(directory);
    const entry = camp.list(SKILL)[0]!;
    expect((entry.metadata.resources as Array<{ path: string; size: number }>).map(item => item.path)).toEqual([
      'references/checklist.md', 'scripts/check.sh', 'assets/logo.txt',
    ]);
    const invoke = (input: JsonObject) => camp.resolve(reader(camp).ref, TOOL).invoke(input, { signal: camp.signal }) as Promise<JsonObject>;
    const result = await invoke({ skill: 'review', path: 'references/checklist.md' });
    expect(result).toMatchObject({ output: 'Check tests.', path: 'references/checklist.md', skill: 'review' });
    expect(result.revision).toMatch(/^[0-9a-f]{64}$/);
    await writeFile(reference, 'Check tests and types.');
    const changed = await invoke({ skill: 'review', path: 'references/checklist.md' });
    expect(changed.revision).not.toBe(result.revision);
    for (const path of ['assets/logo.txt', 'SKILL.md', 'references/../SKILL.md', '/etc/hosts', 'references\\..\\SKILL.md', 'references/']) {
      await expect(invoke({ skill: 'review', path })).rejects.toMatchObject({ code: expect.stringMatching(/INVALID_ARGUMENT|PERMISSION_DENIED/) });
    }
    await expect(invoke({ skill: 'missing', path: 'references/checklist.md' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('符号链接、超限与二进制资源不能被读取', async () => {
    const directory = await root();
    await package_(directory, 'review', document('review', 'Review changes.'));
    const outside = join(await root(), 'secret.md');
    await writeFile(outside, 'secret');
    await mkdir(join(directory, 'review', 'references'), { recursive: true });
    await symlink(outside, join(directory, 'review', 'references', 'escape.md'));
    await resource(directory, 'review', 'references/large.md', 'x'.repeat(32_769));
    await resource(directory, 'review', 'references/binary.md', 'a\u0000b');
    const camp = await campOf(directory);
    const invoke = (path: string) => camp.resolve(reader(camp).ref, TOOL).invoke({ skill: 'review', path }, { signal: camp.signal });
    await expect(invoke('references/escape.md')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(invoke('references/large.md')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(invoke('references/binary.md')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect((camp.list(SKILL)[0]!.metadata.resources as Array<{ path: string }>).map(item => item.path))
      .toEqual(['references/binary.md', 'references/large.md']);
  });

  it('多个来源分别标记，跨来源重名或能力 ID 冲突明确失败', async () => {
    const standard = await root();
    const archer = await root();
    await package_(standard, 'alpha', document('alpha', 'Alpha.'));
    await package_(archer, 'beta', document('beta', 'Beta.'));
    const camp = await campOf(standard, archer);
    expect(camp.list(SKILL).map(entry => [entry.metadata.name, entry.metadata.source])).toEqual([
      ['alpha', 'standard'], ['beta', 'archer'],
    ]);
    await package_(archer, 'alpha', document('other', 'Other.'));
    expect(() => skillsProvider({ roots: [{ source: 'standard', directory: standard }, { source: 'archer', directory: archer }] }))
      .toThrow(/capability id alpha is provided by both/);
    await rm(join(archer, 'alpha'), { recursive: true, force: true });
    await package_(archer, 'archer-id', document('shared', 'From archer.'));
    await package_(standard, 'standard-id', document('shared', 'From standard.'));
    expect(() => skillsProvider({ roots: [{ source: 'standard', directory: standard }, { source: 'archer', directory: archer }] }))
      .toThrow(/name shared is provided by both/);
  });

  it('保留能力 ID、重复来源与非法配置在启动时拒绝', async () => {
    const directory = await root();
    await package_(directory, SKILL_READ_CAPABILITY_ID, document('read-resource', 'Reserved.'));
    expect(() => skillsProvider({ roots: [{ source: 'standard', directory }] })).toThrow(/reserved capability id/);
    const clean = await root();
    expect(() => skillsProvider({ roots: [{ source: 'standard', directory: clean }, { source: 'archer', directory: clean }] })).toThrow(/more than once/);
    expect(() => skillsProvider({ roots: [] })).toThrow(/at least one/);
    expect(() => skillsProvider({ roots: [{ source: 'standard', directory: 'relative/path' }] })).toThrow(/absolute directory/);
  });

  it('缺少目录表示没有技能；非法 SKILL.md 仍明确失败', async () => {
    const missing = join(await root(), 'missing');
    const camp = await campOf(missing);
    expect(camp.list(SKILL)).toEqual([]);
    expect(camp.list(TOOL)).toEqual([]);
    const cases: Array<[string, string]> = [
      ['no-frontmatter', '# Title\n'],
      ['bad-name', '---\nname: Bad_Name\ndescription: Desc.\n---\nBody.\n'],
      ['no-description', '---\nname: sample\n---\nBody.\n'],
      ['empty-body', '---\nname: sample\ndescription: Desc.\n---\n'],
    ];
    for (const [id, content] of cases) {
      const invalid = await root();
      await package_(invalid, id, content);
      expect(() => skillsProvider({ roots: [{ source: 'standard', directory: invalid }] })).toThrow(/Skill package/);
    }
  });

  it('支持折叠与缩进续行的描述，并忽略未知字段和顶层列表', async () => {
    const directory = await root();
    await package_(directory, 'notes', '---\nname: notes\ndescription: >\n  Write durable notes.\n  Keep them short.\nlicense: MIT\nallowed-tools:\n  - Read\n  - Bash\n---\nBody.\n');
    await package_(directory, 'code-review', '---\nname: code-review\ndescription: 审查代码质量、发现潜在问题。\n  当用户要求代码审查时使用。\n---\nBody.\n');
    await mkdir(join(directory, 'scratch'), { recursive: true });
    const camp = await campOf(directory);
    expect(camp.list(SKILL).map(entry => entry.metadata)).toMatchObject([
      { name: 'code-review', description: '审查代码质量、发现潜在问题。 当用户要求代码审查时使用。' },
      { name: 'notes', description: 'Write durable notes. Keep them short.' },
    ]);
  });

  it('超过 64 KiB 的 SKILL.md 在启动和加载时都拒绝', async () => {
    const directory = await root();
    const file = await package_(directory, 'large', document('large', 'Too large.', 'x'.repeat(65_537)));
    expect(() => skillsProvider({ roots: [{ source: 'standard', directory }] })).toThrow(/byte limit/);
    await writeFile(file, document('large', 'Small.'));
    const camp = await campOf(directory);
    await writeFile(file, document('large', 'Small.', 'y'.repeat(65_537)));
    await expect(camp.resolve(camp.list(SKILL)[0]!.ref, SKILL).load({ signal: camp.signal })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('读取前检查取消，不把已取消的加载或资源读取报告为成功', async () => {
    const directory = await root();
    await package_(directory, 'review', document('review', 'Review changes.'));
    await resource(directory, 'review', 'references/checklist.md', 'Check tests.');
    const camp = await campOf(directory);
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(camp.resolve(camp.list(SKILL)[0]!.ref, SKILL).load({ signal: controller.signal })).rejects.toMatchObject({ code: 'ABORTED' });
    await expect(camp.resolve(reader(camp).ref, TOOL).invoke({ skill: 'review', path: 'references/checklist.md' }, { signal: controller.signal }))
      .rejects.toMatchObject({ code: 'ABORTED' });
  });
});

it('两个真实技能走完发现、加载、读取资源并留下 CALL 事实', async () => {
  const standard = await root();
  await package_(standard, 'code-review', document('code-review', '审查代码质量、发现潜在问题。', 'Review checklist:\n1. Read the diff.\n2. Check types.'));
  await package_(standard, 'test-generator', document('test-generator', '根据代码生成测试用例。', 'Generate tests:\nRead references/standards.md first.'));
  await resource(standard, 'test-generator', 'references/standards.md', 'Testing standards: cover failures and boundaries.');
  const app = createArcher({
    camp: testCamp({ builtins: false, providers: [skillsProvider({ roots: [{ source: 'standard', directory: standard }] })], inference: {
      infer: async effect => {
        const last = effect.messages.at(-1);
        if (last?.role !== 'tool') return toolReply(effect, 'skills.code-review');
        if (last.content.includes('Review checklist')) return toolReply(effect, 'skills.test-generator');
        if (last.content.includes('Generate tests')) return toolReply(effect, 'skills.read-resource', { skill: 'test-generator', path: 'references/standards.md' });
        expect(last.content).toContain('Testing standards');
        return { content: 'Finished.' };
      },
    } }),
  });
  cleanups.push(() => app.stop());
  await app.start();
  const agent = await app.agents.create({ id: 'skills', instructions: 'Use skills.' });
  await agent.prompt('Review and test.');
  expect((await agent.getState()).messages.at(-1)?.content).toBe('Finished.');
  const events = await agent.events();
  const calls = events.filter(item => item.fact.scope === 'turn' && item.fact.event.type === 'effect.created'
    && item.fact.event.data.effect.type === 'CALL').map(item => (item.fact.event.data.effect as { target: { contractId: string; capabilityId: string } }).target);
  expect(calls).toMatchObject([
    { contractId: 'archer.skill@1', capabilityId: 'code-review' },
    { contractId: 'archer.skill@1', capabilityId: 'test-generator' },
    { contractId: 'archer.tool@1', capabilityId: 'read-resource' },
  ]);
  const results = events.filter(item => item.fact.scope === 'turn' && item.fact.event.type === 'effect.completed');
  expect(JSON.stringify(results)).toContain('Review checklist');
  expect(JSON.stringify(results)).toContain('Testing standards');
});
it('容器刷新重新发现新增与删除技能，不重建 Camp', async () => {
  const directory = await root();
  await package_(directory, 'review', document('review', 'Review.'));
  const camp = await createCamp({ providers: [{
    id: 'skills',
    create: () => skillsProvider({ roots: [{ source: 'standard', directory }] }),
  }] });
  cleanups.push(() => camp.close());
  await package_(directory, 'deploy', document('deploy', 'Deploy.'));
  await rm(join(directory, 'review'), { recursive: true });
  expect(camp.list(SKILL).map(item => item.metadata.name)).toEqual(['review']);
  await camp.refreshProvider('skills');
  expect(camp.list(SKILL).map(item => item.metadata.name)).toEqual(['deploy']);
  expect(compileModelTools(camp).some(item => item.name === 'load_deploy')).toBe(true);
  expect(reader(camp).metadata.inputSchema).toMatchObject({
    properties: { skill: { enum: ['deploy'] } },
  });
});

it('运行中的 Archer 在后续 Turn 使用刷新后的技能声明', async () => {
  const directory = await root();
  await package_(directory, 'review', document('review', 'Review.'));
  const observed: string[][] = [];
  const camp = await createCamp({ providers: [
    provider('journal', {
      agents: offer(JOURNAL, { description: 'Journal.' }, new MemoryAgentJournal()),
    }),
    provider('inference', {
      model: offer(INFERENCE, { description: 'Infer.' }, {
        infer: async effect => {
          observed.push((effect.tools ?? []).map(item => item.name));
          return { content: 'Done.' };
        },
      }),
    }),
    {
      id: 'skills',
      create: () => skillsProvider({ roots: [{ source: 'standard', directory }] }),
    },
  ] });
  cleanups.push(() => camp.close());
  const app = createArcher({ camp });
  cleanups.push(() => app.stop());
  await app.start();
  const agent = await app.agents.create({ id: 'refresh-skills', instructions: 'Answer.' });
  await agent.prompt('First.');
  await package_(directory, 'deploy', document('deploy', 'Deploy.'));
  await camp.refreshProvider('skills');
  await agent.prompt('Second.');
  expect(observed[0]).not.toContain('load_deploy');
  expect(observed[1]).toContain('load_deploy');
});
