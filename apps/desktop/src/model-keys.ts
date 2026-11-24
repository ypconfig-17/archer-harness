import { safeStorage } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** 本机凭据按服务和实际 API 地址绑定，改地址后的请求不能沿用旧密钥。 */
export class DesktopModelKeys {
  constructor(private readonly directory: string) {}

  private path(provider: string, address: string): string {
    const digest = createHash('sha256').update(JSON.stringify([provider, new URL(address).href])).digest('hex');
    return join(this.directory, digest);
  }

  /** 无法解析的地址没有对应密钥；不能因此掩盖推理侧真正的端点配置问题。 */
  private binding(provider: string, address: string): string | undefined {
    try {
      return this.path(provider, address);
    } catch {
      return undefined;
    }
  }

  private async read(provider: string, address: string): Promise<Buffer | undefined> {
    const file = this.binding(provider, address);
    if (!file) return undefined;
    try {
      return await readFile(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async has(provider: string, address: string): Promise<boolean> {
    return (await this.read(provider, address)) !== undefined;
  }

  private async requireEncryption(): Promise<void> {
    if (!await safeStorage.isAsyncEncryptionAvailable()
      || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
      throw new Error('系统加密存储不可用，请启用系统凭据管理或使用环境变量。');
    }
  }

  async resolve(provider: string, address: string): Promise<string | undefined> {
    const encrypted = await this.read(provider, address);
    if (!encrypted) return undefined;
    await this.requireEncryption();
    return (await safeStorage.decryptStringAsync(encrypted)).result;
  }

  async save(provider: string, address: string, key: string | null): Promise<void> {
    const url = new URL(address);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
      throw new Error('本机密钥需要 HTTPS 模型地址或本机 HTTP 地址。');
    }
    const destination = this.path(provider, address);
    if (key === null) {
      await rm(destination, { force: true });
      return;
    }
    await this.requireEncryption();
    const value = await safeStorage.encryptStringAsync(key);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    // 同目录原子替换。写入失败时，下次推理仍能读取此前保存的密钥。
    try {
      await writeFile(temporary, value, { mode: 0o600, flag: 'wx' });
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
