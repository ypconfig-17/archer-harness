/** 技能正文与资源预览是只读宿主读取：固定引用、鉴权、路径边界与错误映射都由 HTTP 边界保证。 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createArcher } from '@archer/runtime';
import { ArcherClient } from '@archer/client';
import { skill } from '@archer/camp';
import { skillsProvider } from '@archer/skills';
import { testCamp } from '../helpers/application';
import { buildServer } from '../../apps/server/src/app';

async function skillRoot() {
  const directory = await mkdtemp(join(tmpdir(), 'archer-skills-http-'));
  await mkdir(join(directory, 'review', 'references'), { recursive: true });
  await writeFile(join(directory, 'review', 'SKILL.md'), '---\nname: review\ndescription: Review changes.\n---\n\nCheck correctness.\n');
  await writeFile(join(directory, 'review', 'references', 'checklist.md'), 'Cover failures and boundaries.');
  return directory;
}

it('客户端按固定引用读取技能正文与资源，拒绝过期引用与越界路径', async () => {
  const directory = await skillRoot();
  const archer = createArcher({ camp: testCamp({ builtins: false, providers: [skillsProvider({ roots: [{ source: 'standard', directory }] })] }) });
  await archer.start();
  const server = await buildServer({ archer, token: 'admin' });
  try {
    expect((await server.inject({ method: 'GET', url: '/api/skills/skills/review/x' })).statusCode).toBe(401);
    const address = await server.listen({ host: '127.0.0.1', port: 0 });
    const client = new ArcherClient({ baseUrl: address, token: 'admin' });
    const providers = await client.providers();
    const ref = providers.find(item => item.id === 'skills')!.capabilities.find(item => item.ref.capabilityId === 'review')!.ref;
    expect(await client.skillContent(ref)).toMatchObject({ content: 'Check correctness.' });
    expect(await client.skillResource(ref, 'references/checklist.md')).toMatchObject({ path: 'references/checklist.md', content: 'Cover failures and boundaries.' });
    await expect(client.skillContent({ ...ref, revision: '0'.repeat(64) })).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    await expect(client.skillResource(ref, 'references/../SKILL.md')).rejects.toMatchObject({ status: 400 });
    await expect(client.skillResource(ref, 'assets/logo.png')).rejects.toMatchObject({ status: 400 });
  } finally { server.server.closeAllConnections(); await server.close(); await archer.stop(); await rm(directory, { recursive: true, force: true }); }
});

it('来源没有资源读取工具时明确不可预览，不退化为空资源', async () => {
  const archer = createArcher({ camp: testCamp({ builtins: false, providers: [{
    id: 'custom', identity: { provider: 'custom' }, capabilities: {
      guide: skill({ name: 'guide', description: 'Read guidance.', load: async () => ({ content: 'Guidance.' }) }),
    },
  }] }) });
  await archer.start();
  const server = await buildServer({ archer });
  try {
    const address = await server.listen({ host: '127.0.0.1', port: 0 });
    const client = new ArcherClient({ baseUrl: address });
    const ref = (await client.providers()).find(item => item.id === 'custom')!.capabilities[0]!.ref;
    expect(await client.skillContent(ref)).toMatchObject({ content: 'Guidance.' });
    await expect(client.skillResource(ref, 'references/a.md')).rejects.toMatchObject({ status: 404 });
  } finally { server.server.closeAllConnections(); await server.close(); await archer.stop(); }
});