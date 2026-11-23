import { historyProvider } from '@archer/providers';
/** 本地装配 Camp 与 Archer；远程模式只使用公开客户端。 */
import * as path from 'node:path';
import type { AgentManager, ProviderInfo } from '@archer/contracts';
import { ArcherClient } from '@archer/client';
import { createCamp, provider, offer, INFERENCE, INFERENCE_PREPARE } from '@archer/camp';
import { loadPiInference } from '@archer/inference-pi';
import { createArcher, createMockInference } from '@archer/runtime';
import { journalProvider } from '@archer/storage';
import { shellProvider, toolsProvider, projectContextProvider } from '@archer/providers';
import { skillsProvider, defaultSkillsRoots } from '@archer/skills';

export interface CliRuntime {
  agents: AgentManager;
  providers(): Promise<readonly ProviderInfo[]>;
  close(): Promise<void>;
}
export interface RuntimeSelection {
  remote?: string;
  token?: string;
  dataDir?: string;
  /** 本地推理配置；远程模式由 Server 决定。 */
  aiConfig?: string;
}
export async function createCliRuntime(selection: RuntimeSelection): Promise<CliRuntime> {
  const aiConfig = selection.aiConfig?.trim() || undefined;
  if (selection.remote) {
    if (aiConfig) throw new Error('--ai-config 只用于本地模式');
    const client = new ArcherClient({ baseUrl: selection.remote, token: selection.token ?? process.env.HARNESS_TOKEN });
    return { agents: client, providers: () => client.providers(), close: async () => {} };
  }
  const inference = aiConfig === undefined ? createMockInference() : await loadPiInference(path.resolve(aiConfig));
  const dataDir = path.resolve(selection.dataDir ?? process.env.HARNESS_DATA_DIR ?? './data');
  const camp = await createCamp({ providers: [toolsProvider(), historyProvider(), shellProvider(), projectContextProvider(),
    skillsProvider({ roots: defaultSkillsRoots(dataDir) }), journalProvider(dataDir),
    provider('inference', { model: offer(INFERENCE, { description: '使用宿主配置的模型服务进行推理。' }, inference) },
      { identity: { configuration: aiConfig ?? 'mock' } }),
  ] });
  const archer = createArcher({ camp, preparations: camp.list(INFERENCE_PREPARE).filter(item => item.ref.providerId === 'project').map(item => item.ref), onError: error => console.error(`[archer] ${error.code}: ${error.message}`) });
  try { await archer.start(); }
  catch (error) { await camp.close(); throw error; }
  return { agents: archer.agents, providers: async () => camp.providers(), close: async () => {
    await archer.stop({ timeoutMs: 15_000 });
    await camp.close();
  } };
}
