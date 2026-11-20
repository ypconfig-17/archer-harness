/** 内容 revision 只来自文件字节，不混入声明、路径或读取时间。 */
import { createHash } from 'node:crypto';

export function contentRevision(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}