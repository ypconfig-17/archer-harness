/** 受限子 Agent 委托：子会话只见只读能力、拥有独立日志、支持并发只读派发。 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Archer, Inference } from '@archer/contracts';
import { createCamp, offer, provider, tool, INFERENCE, JOURNAL } from '@archer/camp';
import { createArcher, createSubagentProvider } from '@archer/runtime';
import { MemoryAgentJournal } from '@archer/storage';

const running: Archer[] = [];
afterEach(async () => {
  for (const app of running.splice(0)) await app.stop();
});

describe('Subagent 委托 Provider', () => {
  it('子 Agent 只能看到裁剪后的只读工具，且不污染父会话日志', async () => {
    const parentJournal = new MemoryAgentJournal();
    const seenChildTools: string[][] = [];

    const inference: Inference = {
      infer: async (effect) => {
        const toolNames = (effect.tools ?? []).map((t) => t.name);
        // 区分父 Agent 与子 Agent：父 Agent 看得到 subagent_delegate，子 Agent 看不到
        if (toolNames.includes('subagent_delegate')) {
          const toolMsg = effect.messages.find((m) => m.role === 'tool');
          if (toolMsg) {
            return { content: `Parent got: ${toolMsg.content}` };
          }
          return {
            content: '',
            stopReason: 'toolUse',
            toolCalls: [
              { id: 'del-1', name: 'subagent_delegate', input: { task: 'Inspect config' } },
            ],
          };
        }

        // 子 Agent 推理分支
        seenChildTools.push(toolNames);
        const toolMsg = effect.messages.find((m) => m.role === 'tool');
        if (toolMsg) {
          return { content: `Child summary: ${toolMsg.content}` };
        }
        return {
          content: '',
          stopReason: 'toolUse',
          toolCalls: [{ id: 'c-read', name: 'fs_read', input: { path: 'package.json' } }],
        };
      },
    };

    const campHolder: { current?: Awaited<ReturnType<typeof createCamp>> } = {};
    const camp = await createCamp({
      providers: [
        provider('fs', {
          read: tool({
            description: 'Read.',
            inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
            execution: 'read',
            invoke: async (input) => `contents of ${(input as { path: string }).path}`,
          }),
          write: tool({
            description: 'Write.',
            inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
            execution: 'write',
            invoke: async () => 'should-not-run',
          }),
        }),
        provider('journal', {
          agents: offer(JOURNAL, { description: 'Parent journal' }, parentJournal),
        }),
        provider('ai', {
          model: offer(INFERENCE, { description: 'Model' }, inference),
        }),
        {
          id: 'subagent',
          create: () =>
            createSubagentProvider({
              id: 'subagent',
              camp: {
                get signal() {
                  return campHolder.current!.signal;
                },
                providers: () => campHolder.current!.providers(),
                list: (c) => campHolder.current!.list(c),
                resolve: (r, c) => campHolder.current!.resolve(r, c),
                acquire: () => campHolder.current!.acquire(),
                refreshProvider: (id) => campHolder.current!.refreshProvider(id),
                close: () => campHolder.current!.close(),
              },
              scope: { readOnlyTools: true },
            }),
        },
      ],
    });
    campHolder.current = camp;

    const app = createArcher({ camp });
    running.push(app);
    await app.start();

    const parent = await app.agents.create({ id: 'parent', instructions: 'Coordinate.' });
    await parent.prompt('Please inspect package.json via subagent');

    // 子 Agent 只看到 fs_read，看不到 fs_write 和 subagent_delegate
    expect(seenChildTools.length).toBeGreaterThanOrEqual(1);
    for (const tools of seenChildTools) {
      expect(tools).toEqual(['fs_read']);
    }

    const parentState = await parent.getState();
    expect(parentState.messages.at(-1)?.content).toContain('Child summary:');
    // 父日志里只存在 parent 这一个 Agent ID
    expect(await parentJournal.ids()).toEqual(['parent']);
  });
});
