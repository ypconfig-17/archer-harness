#!/usr/bin/env node
/**
 * Archer Harness CLI
 *
 * 本地模式在进程内启动 Archer；远程模式通过 @archer/client 访问 Server。
 * 两种模式共享 Agent / Turn 协议与 SSE 事件。
 */

import 'dotenv/config';
import { createHash } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';
import { Command, InvalidArgumentError } from 'commander';
import { cancel, intro, isCancel, log, outro, text } from '@clack/prompts';
import {
  ArcherError,
  type Agent,
  type SubmitOptions,
  type TurnLimits,
  type TurnStatus,
} from '@archer/contracts';
import { ApiError } from '@archer/client';
import { followTurn } from './follow.js';
import {
  printAgentDetail,
  printAgentTable,
  printTurnTable,
  renderAgentEvent,
  shortTurnId,
} from './format.js';
import { createCliRuntime, type CliRuntime, type RuntimeSelection } from './runtime-factory.js';
import { VERSION } from './version.js';

const CLI_INSTRUCTIONS =
  'You are Archer, a coding agent using the configured workspace tools. '
  + 'Inspect files before changing them, prefer small verified changes, and report concrete results.';

interface RuntimeOptions extends RuntimeSelection {
  remote?: string;
  token?: string;
  dataDir: string;
}

interface RunOptions extends RuntimeOptions {
  workspace: string;
  agent?: string;
  shell?: boolean;
  maxSteps?: number;
  tokenBudget?: number;
  json?: boolean;
}

interface SendOptions extends RuntimeOptions {
  shell?: boolean;
  maxSteps?: number;
  tokenBudget?: number;
  json?: boolean;
}

interface ListOptions extends RuntimeOptions {
  limit: number;
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('必须是正整数');
  }
  return parsed;
}

function addRuntimeOptions(command: Command): Command {
  return command
    .option('-r, --remote <url>', '远程 Server 地址；不填则使用本地模式')
    .option('-t, --token <token>', '管理令牌（也可使用 HARNESS_TOKEN）')
    .option(
      '--data-dir <path>',
      '本地数据目录',
      process.env.HARNESS_DATA_DIR ?? './data',
    )
    .option(
      '--ai-config <path>',
      '本地模式的 pi-ai 配置文件（也可使用 HARNESS_AI_CONFIG；远程模式不支持）',
      process.env.HARNESS_AI_CONFIG,
    );
}

function canonicalDir(value: string): string {
  if (!path.isAbsolute(value)) {
    throw new Error(`工作区必须使用绝对路径：${value}`);
  }
  const resolved = realpathSync(value);
  if (!statSync(resolved).isDirectory()) {
    throw new Error(`工作区不是目录：${value}`);
  }
  return resolved;
}

function defaultAgentId(workspace: string): string {
  const base = path.basename(workspace).replace(/[^A-Za-z0-9_.-]/g, '-') || 'workspace';
  const hash = createHash('sha1').update(workspace).digest('hex').slice(0, 8);
  return `${base.slice(0, 96)}-${hash}`;
}

function isConflict(error: unknown): boolean {
  return (
    (error instanceof ArcherError || error instanceof ApiError)
    && error.code === 'CONFLICT'
  );
}

async function createAgent(
  runtime: CliRuntime,
  id: string,
  cwd: string,
): Promise<Agent> {
  try {
    return await runtime.agents.create({ id, instructions: CLI_INSTRUCTIONS, workspace: { cwd, access: 'edit' } });
  } catch (error: unknown) {
    if (!isConflict(error)) throw error;
    const existing = await runtime.agents.get(id);
    if (!existing) throw error;
    const snapshot = await existing.getState();
    if (snapshot.workspace?.cwd !== cwd) throw error;
    return existing;
  }
}

function turnLimits(options: { maxSteps?: number; tokenBudget?: number }): TurnLimits | undefined {
  const limits: TurnLimits = {
    ...(options.maxSteps === undefined ? {} : { maxInferenceSteps: options.maxSteps }),
    ...(options.tokenBudget === undefined ? {} : { tokenBudget: options.tokenBudget }),
  };
  return Object.keys(limits).length === 0 ? undefined : limits;
}

async function sendAndFollow(
  agent: Agent,
  task: string,
  options: { shell?: boolean; json?: boolean; limits?: TurnLimits },
): Promise<TurnStatus> {
  let activeTurnId: string | null = null;
  const onSigint = (): void => {
    if (activeTurnId) {
      void agent.abort({ turnId: activeTurnId, reason: 'CLI 收到中断' });
    }
  };
  process.once('SIGINT', onSigint);

  try {
    const submitOptions: SubmitOptions = {
      allowShell: options.shell === true,
      commandMode: 'full',
      ...(options.limits === undefined ? {} : { limits: options.limits }),
    };
    const turn = await agent.send(task, submitOptions);
    activeTurnId = turn.turnId;
    if (options.json !== true) {
      log.info(`Turn ${shortTurnId(turn.turnId)} 已提交`);
    }
    return await followTurn(agent, turn.turnId, { json: options.json });
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}

async function readTask(parts: string[] | undefined): Promise<string | null> {
  const provided = (parts ?? []).join(' ').trim();
  if (provided) return provided;
  if (!process.stdin.isTTY) {
    log.error('非交互环境必须通过参数提供任务内容');
    return null;
  }
  const answer = await text({
    message: '请输入任务内容：',
    placeholder: '例如：检查项目结构并总结',
  });
  if (isCancel(answer)) {
    cancel('已取消');
    return null;
  }
  const task = String(answer).trim();
  if (!task) {
    log.error('任务内容不能为空');
    return null;
  }
  return task;
}

const program = new Command();

program
  .name('archer')
  .description('Archer Harness —— 面向受控工作区的 Agent 运行时')
  .version(VERSION);

addRuntimeOptions(
  program
    .command('run [task...]')
    .description('绑定工作环境、创建或复用 Agent，并执行一次 Turn')
    .requiredOption('-w, --workspace <path>', '工作区绝对路径（必填，显式选择）')
    .option('--agent <id>', '复用或创建指定 Agent；默认按工作区派生')
    .option('--shell', '允许本次 Turn 使用 Shell 能力')
    .option('--max-steps <n>', '本次 Turn 的最大推理步数（默认不限制）', parsePositiveInt)
    .option('--token-budget <n>', '本次 Turn 的 token 预算', parsePositiveInt)
    .option('--json', '以 JSONL 输出 Turn 事件'),
).action(async (taskParts: string[], options: RunOptions) => {
  const task = await readTask(taskParts);
  if (!task) {
    process.exitCode = 1;
    return;
  }

  const workspace = canonicalDir(options.workspace);
  const runtime = await createCliRuntime(options);
  const json = options.json === true;
  if (!json) intro('Archer Harness');

  try {
    const agent = await createAgent(
      runtime,
      options.agent ?? defaultAgentId(workspace),
      workspace,
    );

    if (!json) log.info(`Agent：${agent.id}；模式：${options.remote ? '远程' : '本地'}`);
    const status = await sendAndFollow(agent, task, {
      shell: options.shell,
      json,
      limits: turnLimits(options),
    });
    if (!json) outro(status === 'completed' ? 'Turn 完成' : `Turn 结束：${status}`);
    process.exitCode = status === 'completed' ? 0 : 1;
  } catch (error: unknown) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await runtime.close();
  }
});

addRuntimeOptions(
  program
    .command('send <agentId> [task...]')
    .description('向既有 Agent 发送一次 Turn')
    .option('--shell', '允许本次 Turn 使用 Shell 能力')
    .option('--max-steps <n>', '本次 Turn 的最大推理步数（默认不限制）', parsePositiveInt)
    .option('--token-budget <n>', '本次 Turn 的 token 预算', parsePositiveInt)
    .option('--json', '以 JSONL 输出 Turn 事件'),
).action(async (agentId: string, taskParts: string[], options: SendOptions) => {
  const task = await readTask(taskParts);
  if (!task) {
    process.exitCode = 1;
    return;
  }

  const runtime = await createCliRuntime(options);
  const json = options.json === true;
  if (!json) intro('Archer Harness');

  try {
    const agent = await runtime.agents.get(agentId);
    if (!agent) throw new Error(`Agent 不存在：${agentId}`);
    const status = await sendAndFollow(agent, task, {
      shell: options.shell,
      json,
      limits: turnLimits(options),
    });
    if (!json) outro(status === 'completed' ? 'Turn 完成' : `Turn 结束：${status}`);
    process.exitCode = status === 'completed' ? 0 : 1;
  } catch (error: unknown) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await runtime.close();
  }
});

addRuntimeOptions(
  program
    .command('agents')
    .description('列出 Agent')
    .option('-l, --limit <n>', '返回数量', parsePositiveInt, 50),
).action(async (options: ListOptions) => {
  const runtime = await createCliRuntime(options);
  try {
    printAgentTable(await runtime.agents.list({ limit: options.limit }));
  } catch (error: unknown) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await runtime.close();
  }
});

addRuntimeOptions(
  program
    .command('turns <agentId>')
    .description('列出 Agent 的 Turn')
    .option('-l, --limit <n>', '返回数量', parsePositiveInt, 20),
).action(async (agentId: string, options: ListOptions) => {
  const runtime = await createCliRuntime(options);
  try {
    const agent = await runtime.agents.get(agentId);
    if (!agent) throw new Error(`Agent 不存在：${agentId}`);
    printTurnTable(await agent.turns.list({ limit: options.limit }));
  } catch (error: unknown) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await runtime.close();
  }
});

addRuntimeOptions(
  program
    .command('show <agentId>')
    .description('查看 Agent 状态与最近事件')
    .option('-l, --limit <n>', '事件数量', parsePositiveInt, 30)
    .option('--json', '以 JSONL 输出事件'),
).action(async (agentId: string, options: ListOptions & { json?: boolean }) => {
  const runtime = await createCliRuntime(options);
  try {
    const agent = await runtime.agents.get(agentId);
    if (!agent) throw new Error(`Agent 不存在：${agentId}`);
    if (options.json !== true) {
      printAgentDetail(await agent.getState());
    }
    const events = await agent.events({ limit: options.limit });
    if (options.json !== true) console.log(`\n最近事件（${events.length} 条）：`);
    for (const event of events) renderAgentEvent(event, options.json === true);
  } catch (error: unknown) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await runtime.close();
  }
});

addRuntimeOptions(
  program
    .command('follow <agentId> <turnId>')
    .description('跟踪一个 Turn 直到终态')
    .option('--json', '以 JSONL 输出事件'),
).action(async (agentId: string, turnId: string, options: RuntimeOptions & { json?: boolean }) => {
  const runtime = await createCliRuntime(options);
  try {
    const agent = await runtime.agents.get(agentId);
    if (!agent) throw new Error(`Agent 不存在：${agentId}`);
    const status = await followTurn(agent, turnId, { json: options.json === true });
    if (options.json !== true) outro(status === 'completed' ? 'Turn 完成' : `Turn 结束：${status}`);
    process.exitCode = status === 'completed' ? 0 : 1;
  } catch (error: unknown) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await runtime.close();
  }
});

addRuntimeOptions(
  program
    .command('abort <agentId> [turnId]')
    .description('请求取消活跃 Turn')
    .option('--reason <text>', '取消原因'),
).action(async (
  agentId: string,
  turnId: string | undefined,
  options: RuntimeOptions & { reason?: string },
) => {
  const runtime = await createCliRuntime(options);
  try {
    const agent = await runtime.agents.get(agentId);
    if (!agent) throw new Error(`Agent 不存在：${agentId}`);
    await agent.abort({
      ...(turnId === undefined ? {} : { turnId }),
      ...(options.reason === undefined ? {} : { reason: options.reason }),
    });
    log.info('已提交取消请求；执行是否停止以 Turn 事件为准');
  } catch (error: unknown) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await runtime.close();
  }
});

addRuntimeOptions(program.command('providers').description('列出能力提供者')).action(async (options: RuntimeOptions) => {
  const runtime = await createCliRuntime(options);
  try { console.log(JSON.stringify(await runtime.providers(), null, 2)); }
  finally { await runtime.close(); }
});

try {
  await program.parseAsync(process.argv);
} catch (err: unknown) {
  log.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
