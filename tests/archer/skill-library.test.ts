/** 宿主新增包不得覆盖或热注册能力；保存失败不留下半个技能包。 */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createSkillLibrary } from '../../apps/server/src/skill-library';
import { buildServer } from '../../apps/server/src/app';
import { createArcher } from '@archer/runtime';
import { skillsProvider } from '@archer/skills';
import { testCamp } from '../helpers/application';

const document = '---\nname: review\ndescription: Review changes.\n---\n\nCheck correctness.\n';

it('新增必须鉴权，成功只落文件；并发重名仅成功一次且 Camp 能力不变', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'archer-library-'));
  const roots = [{ source: 'archer', directory }];
  const archer = createArcher({ camp: testCamp({ builtins: false, providers: [skillsProvider({ roots })] }) });
  await archer.start();
  const server = await buildServer({ archer, inference: 'mock', token: 'admin', skillLibrary: createSkillLibrary(roots) });
  try {
    const request = { method: 'POST' as const, url: '/api/skills/library', payload: { content: document } };
    expect((await server.inject(request)).statusCode).toBe(401);
    const responses = await Promise.all([server.inject({ ...request, headers: { authorization: 'Bearer admin' } }), server.inject({ ...request, headers: { authorization: 'Bearer admin' } })]);
    expect(responses.map(item => item.statusCode).sort()).toEqual([200, 409]);
    expect(responses.find(item => item.statusCode === 200)!.json()).toMatchObject({ name: 'review', activation: 'restart-required' });
    expect(await readFile(join(directory, 'review', 'SKILL.md'), 'utf8')).toBe(document);
    expect(archer.camp.providers().find(item => item.id === 'skills')!.capabilities).toHaveLength(0);
  } finally {
    await server.close();
    await archer.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

it('拒绝非法名称、超限和保留名称，校验失败不写磁盘', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'archer-library-invalid-'));
  try {
    const library = createSkillLibrary([{ source: 'archer', directory }]);
    await expect(library.add(document.replace('name: review', 'name: ../escape'))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(library.add(document + 'x'.repeat(65536))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(library.add(document.replace('name: review', 'name: read-resource'))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(await readdir(directory)).toEqual([]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
