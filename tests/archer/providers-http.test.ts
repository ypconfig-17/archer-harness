/** Provider 声明只读，远程入口不装载宿主代码。 */
import { expect, it } from 'vitest';
import { createArcher } from '@archer/runtime';
import { ArcherClient } from '@archer/client';
import { testCamp } from '../helpers/application';
import { buildServer } from '../../apps/server/src/app';
it('HTTP 与客户端列出 Provider，入口鉴权覆盖能力声明', async () => {
  const archer = createArcher({ camp: testCamp() }); await archer.start();
  const server = await buildServer({ archer, inference: 'mock', token: 'admin' });
  try {
    expect((await server.inject({ method: 'GET', url: '/api/providers' })).statusCode).toBe(401);
    const address = await server.listen({ host: '127.0.0.1', port: 0 });
    const client = new ArcherClient({ baseUrl: address, token: 'admin' });
    const providers = await client.providers();
    expect(providers.map(item => item.id)).toEqual(['journal', 'inference', 'files', 'shell']);
    expect(providers.find(item => item.id === 'files')!.capabilities.map(item => item.ref.capabilityId)).toContain('read');
    const agent = await client.create({ id: 'remote', instructions: 'Answer.' });
    await agent.prompt('Hello');
    expect((await agent.getState()).messages.at(-1)?.content).toBe('Done.');
    await client.configureExecution(agent.id, { expectedRevision: 0 });
  } finally { server.server.closeAllConnections(); await server.close(); await archer.stop(); }
});
