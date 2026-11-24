import { randomUUID } from 'node:crypto';
import type { PiInferenceOptions } from '@archer/inference-pi';

/** 只有桌面启动的 Server 才启用父进程凭据查询。并发推理分别匹配各自的响应。 */
export function desktopModelKeyResolver(): PiInferenceOptions['resolveApiKey'] {
  if (process.env.ARCHER_DESKTOP_MODEL_KEYS !== '1' || !process.send) return undefined;
  const pending = new Map<string, (key?: string, failed?: boolean) => void>();
  process.on('message', (message: unknown) => {
    if (!message || typeof message !== 'object'
      || !('type' in message) || message.type !== 'archer.model-key'
      || !('id' in message) || typeof message.id !== 'string') return;
    const key = 'key' in message && typeof message.key === 'string' ? message.key : undefined;
    pending.get(message.id)?.(key, 'failed' in message && message.failed === true);
  });
  process.once('disconnect', () => {
    for (const finish of pending.values()) finish(undefined, true);
  });
  return (provider, address) => new Promise<string | undefined>((resolve, reject) => {
    const id = randomUUID();
    const finish = (key?: string, failed?: boolean): void => {
      if (!pending.delete(id)) return;
      clearTimeout(timer);
      if (failed) reject(new Error('无法读取桌面保存的模型密钥，请检查系统凭据存储。'));
      else resolve(key);
    };
    // 父进程退出或未回复必须有界失败，不能把未知状态当成没有配置密钥。
    const timer = setTimeout(() => finish(undefined, true), 5_000);
    pending.set(id, finish);
    if (!process.connected || !process.send) {
      finish(undefined, true);
      return;
    }
    process.send({ type: 'archer.model-key', id, provider, address }, error => {
      if (error) finish(undefined, true);
    });
  });
}
