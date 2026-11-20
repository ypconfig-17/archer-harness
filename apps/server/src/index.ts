import { createSkillLibrary } from './skill-library.js';
/**
 * Archer Harness — Server 入口
 *
 * 读取环境变量、装配 Archer、启动 HTTP 服务并在退出时收敛会话。
 */

import 'dotenv/config';
import './stream-diagnostics.js';
import * as path from 'node:path';
import { buildServer } from './app.js';
import { createArcher } from '@archer/runtime';
import { createCamp, provider, offer, INFERENCE, INFERENCE_PREPARE } from '@archer/camp';
import { toolsProvider, historyProvider, shellProvider, projectContextProvider } from '@archer/providers';
import { skillsProvider, defaultSkillsRoots } from '@archer/skills';
import { createModelSettings } from './model-settings.js';
import { RecoveryRecords } from './recovery-records.js';
import { journalProvider } from '@archer/storage';

const SHUTDOWN_TIMEOUT_MS = 15_000;

async function main(): Promise<void> {
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 3000);
  const token = process.env.HARNESS_TOKEN || undefined;
  const dataDir = path.resolve(process.env.HARNESS_DATA_DIR ?? './data');
  const aiConfigPath = process.env.HARNESS_AI_CONFIG?.trim() || undefined;

  const modelSettings = await createModelSettings(path.join(dataDir, 'model-settings.json'), aiConfigPath ? path.resolve(aiConfigPath) : undefined);
  const inference = modelSettings.inference;

  const recoveryRecords = new RecoveryRecords(dataDir);
  const camp = await createCamp({ providers: [toolsProvider(), historyProvider(), shellProvider(), projectContextProvider(),
    skillsProvider({ roots: defaultSkillsRoots(dataDir) }), journalProvider(dataDir),
    provider('inference', { model: offer(INFERENCE, { description: '使用宿主配置的模型服务进行推理。' }, inference) }, { identity: { source: 'server-model-settings' } }),
  ] });
  const archer = createArcher({ camp, preparations: camp.list(INFERENCE_PREPARE).filter(item => item.ref.providerId === 'project').map(item => item.ref),
    onError: (error) => {
      if (error.details?.recovery === true && typeof error.details.agentId === 'string') {
        recoveryRecords.record(
          error.details.agentId,
          typeof error.details.cause === 'string' ? error.details.cause : error.message,
        );
      }
      console.error(`[archer] ${error.code}: ${error.message}`);
      if (error.details?.recovery === true && typeof error.details.cause === 'string') console.error(`[archer] 恢复诊断：${error.details.cause}`);
    }
  });

  let app: Awaited<ReturnType<typeof buildServer>> | undefined;
  try {
    app = await buildServer({ archer, modelSettings, recoveryRecords,
      skillLibrary: createSkillLibrary(defaultSkillsRoots(dataDir)),
      token, inference: modelSettings.get().mode, logger: { level: process.env.LOG_LEVEL ?? 'info' } });
    await archer.start();
    const url = await app.listen({ host, port });
    process.send?.({ type: 'archer.ready', url });
    app.log.info(`Archer Server 已启动：${url}`);
    app.log.info(token ? '管理令牌鉴权已开启' : '管理令牌为空，鉴权已关闭（仅建议本机使用）');
    app.log.info(`推理实现：${modelSettings.get().mode}；模型服务可通过设置面板配置`);
  } catch (error) {
    const failures: unknown[] = [error];
    // 先收束执行，再关闭借用的 Camp；清理失败同时保留原始错误。
    try { await archer.stop(); } catch (failure) { failures.push(failure); }
    try { app?.server.closeAllConnections(); await app?.close(); } catch (failure) { failures.push(failure); }
    try { await camp.close(); } catch (failure) { failures.push(failure); }
    throw new AggregateError(failures, 'Server startup failed.');
  }
  const server = app;
  let stopping: Promise<void> | undefined;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    server.log.info(`收到 ${signal}，正在关闭服务`);
    stopping = (async () => {
      const closing = server.close();
      // 防止关闭 HTTP 的拒绝在等待执行期间成为未处理异常。
      void closing.catch(() => undefined);
      await archer.stop({ timeoutMs: SHUTDOWN_TIMEOUT_MS });
      await camp.close();
      server.server.closeAllConnections();
      await closing;
    })();
    void stopping.then(() => process.exit(0), error => { console.error('Server 关闭失败：', error); process.exit(1); });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  if (process.send) process.once('disconnect', () => shutdown('parent disconnected'));
}

main().catch((err: unknown) => {
  console.error('Server 启动失败：', err);
  process.exit(1);
});
