/** 测试应用使用生产 Contract 装配，资源归 Archer 所有。 */
import type { AgentJournal, Dependency, Camp, Inference, Provider } from '@archer/contracts';
import { createCamp, provider, offer, INFERENCE, JOURNAL } from '@archer/camp';
import { MemoryAgentJournal } from '@archer/storage';
import { toolsProvider, shellProvider } from '@archer/providers';
export function testCamp(input: { journal?: AgentJournal; inference?: Inference; providers?: Provider[]; builtins?: boolean } = {}): Dependency<Camp> {
  return { open: async ({ signal }) => {
    const value = await createCamp({ signal, providers: [
      provider('journal', { agents: offer(JOURNAL, { description: 'Test journal.' }, input.journal ?? new MemoryAgentJournal()) }),
      provider('inference', { model: offer(INFERENCE, { description: 'Test inference.' }, input.inference ?? { infer: async () => ({ content: 'Done.' }) }) }),
      ...(input.builtins === false ? [] : [toolsProvider(), shellProvider()]), ...(input.providers ?? []),
    ] });
    return { value, close: () => value.close() };
  } };
}
