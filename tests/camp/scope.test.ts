/** scopeCamp 受限能力视图：隐藏列表、拦截越权 resolve、共享借用计数、隔离 close/refresh。 */
import { describe, expect, it } from 'vitest';
import { ArcherError } from '@archer/contracts';
import { createCamp, offer, provider, scopeCamp, skill, tool, INFERENCE, TOOL, SKILL } from '@archer/camp';

describe('scopeCamp 能力视图裁剪', () => {
  it('按策略过滤只读工具与技能，并在 resolve 边界拒绝越权引用', async () => {
    const camp = await createCamp({
      providers: [
        provider('fs', {
          read: tool({
            description: 'Read file.',
            inputSchema: { type: 'object', properties: {} },
            execution: 'read',
            invoke: async () => 'ok',
          }),
          write: tool({
            description: 'Write file.',
            inputSchema: { type: 'object', properties: {} },
            execution: 'write',
            invoke: async () => 'written',
          }),
        }),
        provider('guide', {
          review: skill({
            name: 'review',
            description: 'Review code.',
            load: async () => ({ content: 'Check tests.' }),
          }),
        }),
        provider('ai', {
          model: offer(INFERENCE, { description: 'Model' }, { infer: async () => ({ content: '' }) }),
        }),
      ],
    });

    try {
      const writeRef = camp.list(TOOL).find((entry) => entry.ref.capabilityId === 'write')!.ref;
      const skillRef = camp.list(SKILL)[0]!.ref;
      const scoped = scopeCamp(camp, { readOnlyTools: true, hideSkills: true });

      expect(scoped.list(TOOL).map((entry) => entry.ref.capabilityId)).toEqual(['read']);
      expect(scoped.list(SKILL)).toHaveLength(0);
      expect(scoped.list(INFERENCE)).toHaveLength(1);

      expect(() => scoped.resolve(writeRef, TOOL)).toThrowError(ArcherError);
      expect(() => scoped.resolve(skillRef, SKILL)).toThrowError('outside the scoped Camp view');
      await expect(scoped.refreshProvider('fs')).rejects.toThrowError('cannot refresh parent providers');

      // 关闭借用视图不应关闭父 Camp
      await scoped.close();
      expect(camp.list(TOOL)).toHaveLength(2);
    } finally {
      await camp.close();
    }
  });

  it('子视图的 acquire 借用透传给父 Camp，保护共享资源释放时机', async () => {
    let closed = false;
    const camp = await createCamp({
      providers: [
        provider(
          'res',
          {
            ping: tool({
              description: 'Ping.',
              inputSchema: { type: 'object', properties: {} },
              execution: 'read',
              invoke: async () => 'pong',
            }),
          },
          {
            close: async () => {
              closed = true;
            },
          },
        ),
      ],
    });

    const scoped = scopeCamp(camp, { allowProviders: ['res'] });
    const release = scoped.acquire();
    const closePromise = camp.close();

    await Promise.resolve();
    expect(closed).toBe(false);

    release();
    await closePromise;
    expect(closed).toBe(true);
  });
});
