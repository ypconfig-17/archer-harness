/** 完全访问的配置与当前命令批准共用提交边界，旧确认不能命中新等待项。 */
import { expect, it } from 'vitest';
import { provider, tool } from '@archer/camp';
import { createArcher } from '@archer/runtime';
import { MemoryAgentJournal } from '@archer/storage';
import { replayAgent } from '@archer/agent';
import { testCamp } from '../helpers/application';
import { toolReply } from '../helpers/inference';
async function setup() {
    let invoked = 0;
    const journal = new MemoryAgentJournal();
    const archer = createArcher({ camp: testCamp({ builtins: false, journal,
            providers: [provider('commands', { run: tool({
                        description: 'Test command.', inputSchema: { type: 'object' }, execution: 'shell',
                        invoke: async () => { invoked++; return { output: 'ok' }; },
                    }) })],
            inference: { infer: async (effect) => effect.messages.some(message => message.role === 'tool')
                    ? { content: 'Done.' } : toolReply(effect, 'commands.run', { command: 'test-only' }) },
        }) });
    await archer.start();
    const agent = await archer.agents.create({ id: 'full-access', instructions: 'Test.' });
    const turn = await agent.send('Go', { allowShell: true, commandMode: 'ask' });
    await expect.poll(async () => (await agent.getState()).activeTurn?.pending?.kind).toBe('human');
    const state = await agent.getState();
    const target = { turnId: turn.turnId, effectId: state.activeTurn!.pending!.effectId };
    return { archer, agent, journal, state, target, invoked: () => invoked };
}
it('一次确认同时提交模式与恢复许可，凭证不入日志且恢复回放不重复执行', async () => {
    const test = await setup();
    try {
        const token = await test.archer.agents.issueHumanToken(test.agent.id, test.target);
        await test.archer.agents.configureExecution(test.agent.id, { expectedRevision: test.state.executionRevision,
            commandAuthorization: { turnId: test.target.turnId, allowShell: true, commandMode: 'full',
                expectedPendingEffectId: test.target.effectId, approveCommand: { effectId: test.target.effectId, token: token.token } },
        });
        await test.agent.wait(test.target.turnId);
        expect(test.invoked()).toBe(1);
        const events = await test.journal.read(test.agent.id);
        expect(JSON.stringify(events)).not.toContain(token.token);
        const types = events.filter(event => event.fact.scope === 'turn').map(event => event.fact.event.type);
        expect(types.indexOf('turn.authorization.changed')).toBeLessThan(types.indexOf('effect.resumed'));
        expect(replayAgent(test.agent.id, events)?.turns.get(test.target.turnId)?.commandMode).toBe('full');
        await expect(test.archer.agents.configureExecution(test.agent.id, { expectedRevision: test.state.executionRevision,
            commandAuthorization: { turnId: test.target.turnId, allowShell: true, commandMode: 'full', expectedPendingEffectId: test.target.effectId,
                approveCommand: { effectId: test.target.effectId, token: token.token } },
        })).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(test.invoked()).toBe(1);
    }
    finally {
        await test.archer.stop();
    }
});
it('凭证错误、配置过期或等待项改变时两项都不生效，不执行命令', async () => {
    const test = await setup();
    try {
        const token = await test.archer.agents.issueHumanToken(test.agent.id, test.target);
        const authorization = { turnId: test.target.turnId, allowShell: true, commandMode: 'full' as const,
            expectedPendingEffectId: test.target.effectId, approveCommand: { effectId: test.target.effectId, token: token.token } };
        for (const input of [
            { expectedRevision: test.state.executionRevision, commandAuthorization: { ...authorization, approveCommand: { ...authorization.approveCommand, token: 'wrong' } } },
            { expectedRevision: test.state.executionRevision + 1, commandAuthorization: authorization },
            { expectedRevision: test.state.executionRevision, commandAuthorization: { ...authorization, expectedPendingEffectId: null, approveCommand: undefined } },
        ])
            await expect(test.archer.agents.configureExecution(test.agent.id, input)).rejects.toMatchObject({ code: 'CONFLICT' });
        const current = await test.agent.getState();
        expect(current.executionRevision).toBe(test.state.executionRevision);
        expect(current.activeTurn?.commandMode).toBe('ask');
        expect(current.activeTurn?.pending?.effectId).toBe(test.target.effectId);
        expect(test.invoked()).toBe(0);
    }
    finally {
        await test.archer.stop();
    }
});
