import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createArcher } from '@archer/runtime';
import { JsonlAgentJournal } from '@archer/storage';
import { ArcherClient } from '@archer/client';
import { testCamp } from '../helpers/application';
import { buildServer } from '../../apps/server/src/app';
import { RecoveryRecords } from '../../apps/server/src/recovery-records';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'archer-recovery-records-'));
  directories.push(directory);
  await mkdir(join(directory, 'agents'));
  const content = '{broken original log}\n';
  await writeFile(join(directory, 'agents', 'broken.jsonl'), content);
  await writeFile(join(directory, 'agents', 'healthy.jsonl'), '[]\n');
  const records = new RecoveryRecords(directory);
  records.record('broken', '日志格式不符合协议');
  return { directory, content, records };
}

it('只处理确认恢复失败的记录，移出后原始字节保留且启动枚举不再加载', async () => {
  const { directory, content, records } = await fixture();
  await expect(records.isolate('healthy')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(records.export('../healthy')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  records.record('../escape', '非法路径');
  expect(records.list()).toHaveLength(1);
  expect(await records.export('broken')).toEqual({ contentBase64: Buffer.from(content).toString('base64') });
  await records.isolate('broken');
  expect(records.list()).toEqual([]);
  expect(await new JsonlAgentJournal(join(directory, 'agents')).ids()).toEqual(['healthy']);
  const [folder] = await readdir(join(directory, 'isolated-agents'));
  expect(await readFile(join(directory, 'isolated-agents', folder!, 'broken.jsonl'), 'utf8')).toBe(content);
  await expect(records.isolate('broken')).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

it('原始导出与隔离均保留无效 UTF-8 字节，不以文本解码替换损坏内容', async () => {
  const { directory, records } = await fixture();
  const bytes = Buffer.from([0xff, 0xfe, 0x0a, 0x80]);
  await writeFile(join(directory, 'agents', 'broken.jsonl'), bytes);
  expect(Buffer.from((await records.export('broken')).contentBase64, 'base64')).toEqual(bytes);
  await records.isolate('broken');
  const [folder] = await readdir(join(directory, 'isolated-agents'));
  expect(await readFile(join(directory, 'isolated-agents', folder!, 'broken.jsonl'))).toEqual(bytes);
});

it('移动失败保留诊断与重试入口，不虚报清理成功', async () => {
  const { directory, records } = await fixture();
  await rm(join(directory, 'agents', 'broken.jsonl'));
  await expect(records.isolate('broken')).rejects.toBeDefined();
  expect(records.list()).toHaveLength(1);
});

it('管理接口统一鉴权，客户端导出与移出后健康计数立即更新', async () => {
  const { content, records } = await fixture();
  const archer = createArcher({ camp: testCamp() });
  await archer.start();
  const server = await buildServer({ archer, token: 'admin', recoveryRecords: records });
  try {
    for (const [method, url] of [
      ['GET', '/api/recovery-records'],
      ['GET', '/api/recovery-records/broken/export'],
      ['DELETE', '/api/recovery-records/broken'],
    ] as const) {
      expect((await server.inject({ method, url })).statusCode).toBe(401);
    }
    const address = await server.listen({ host: '127.0.0.1', port: 0 });
    const client = new ArcherClient({ baseUrl: address, token: 'admin' });
    expect(await client.recoveryRecords()).toEqual([{ agentId: 'broken', reason: '日志格式不符合协议' }]);
    expect(await client.exportRecoveryRecord('broken')).toEqual({ contentBase64: Buffer.from(content).toString('base64') });
    await client.isolateRecoveryRecord('broken');
    expect(await client.recoveryRecords()).toEqual([]);
    expect((await server.inject('/api/health')).json().recoveryFailures).toBe(0);
  } finally {
    server.server.closeAllConnections();
    await server.close();
    await archer.stop();
  }
});
