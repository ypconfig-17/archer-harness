import { testCamp } from '../helpers/application';
/** 独立部署的 Web 必须能够读取 HTTP 与 SSE 的同一组跨域响应头。 */
import { expect, it } from 'vitest';
import { createArcher, createMockInference } from '@archer/runtime';
import { MemoryAgentJournal } from '@archer/storage';
import { buildServer } from '../../apps/server/src/app.js';

it('Agent 与 Turn 的 SSE 保留跨域头，并只补齐游标之后的事实', async () => {
  const archer = createArcher({
    camp: testCamp({ journal: new MemoryAgentJournal(),
      inference: createMockInference() }),

  });
  await archer.start();
  const server = await buildServer({ archer, inference: 'mock' });
  try {
    const agent = await archer.agents.create({ id: 'sse-cors', instructions: 'Inspect visible nodes.' });
    await agent.prompt('Inspect.');
    const turn = (await agent.turns.list())[0]!;
    const address = await server.listen({ host: '127.0.0.1', port: 0 });
    for (const path of [
      `/api/agents/${agent.id}/events/stream?afterSeq=1`,
      `/api/agents/${agent.id}/turns/${encodeURIComponent(turn.turnId)}/events/stream?afterSeq=1`,
    ]) {
      const controller = new AbortController();
      try {
        const response = await fetch(`${address}${path}`, { headers: { Origin: 'http://localhost:5173' }, signal: controller.signal });
        expect(response.status).toBe(200);
        expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
        expect(response.headers.get('content-type')).toContain('text/event-stream');
        const reader = response.body!.getReader();
        let text = '';
        while (!text.includes('data: ')) {
          const chunk = await reader.read();
          if (chunk.done) break;
          text += new TextDecoder().decode(chunk.value);
        }
        expect(text).toContain('"seq":2');
        expect(text).not.toContain('"seq":1,');
        await reader.cancel();
      } finally { controller.abort(); }
    }
  } finally {
    server.server.closeAllConnections();
    await server.close();
    await archer.stop();
  }
});
