/** 异常日志管理只接受本次启动确认恢复失败的标识，不参与 Agent 调度。 */
import { mkdir, mkdtemp, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { ArcherError, type RecoveryFailure } from '@archer/contracts';

export class RecoveryRecords {
  private readonly failures = new Map<string, RecoveryFailure>();
  private readonly moving = new Set<string>();

  constructor(private readonly directory: string) {}

  record(agentId: string, reason: string): void {
    // 与 Journal 的文件标识边界一致，禁止诊断标识被解释为路径。
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(agentId)) return;
    this.failures.set(agentId, { agentId, reason });
  }

  list(): RecoveryFailure[] {
    return [...this.failures.values()];
  }

  private assertFailed(agentId: string): void {
    if (!this.failures.has(agentId)) {
      throw new ArcherError('NOT_FOUND', '未找到本次启动恢复失败的记录');
    }
  }

  async export(agentId: string): Promise<{ contentBase64: string }> {
    this.assertFailed(agentId);
    const bytes = await readFile(join(this.directory, 'agents', `${agentId}.jsonl`));
    return { contentBase64: bytes.toString('base64') };
  }

  async isolate(agentId: string): Promise<void> {
    this.assertFailed(agentId);
    if (this.moving.has(agentId)) throw new ArcherError('CONFLICT', '正在移出该记录');
    this.moving.add(agentId);
    try {
      // 每次使用独立目录，避免覆盖既有隔离记录；只移动原文件，不解析或改写事实。
      const isolated = join(this.directory, 'isolated-agents');
      await mkdir(isolated, { recursive: true });
      const target = await mkdtemp(join(isolated, `${agentId}-`));
      await rename(join(this.directory, 'agents', `${agentId}.jsonl`), join(target, `${agentId}.jsonl`));
      // 移动成功后才清除诊断，失败保留原有处理入口。
      this.failures.delete(agentId);
    } finally {
      this.moving.delete(agentId);
    }
  }
}
