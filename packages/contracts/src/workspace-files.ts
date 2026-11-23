/** 显式工作环境的文件端口；路径为宿主工作目录路径。 */
import { z } from 'zod';
import type { KernelError, Result } from './error.js';
import { KernelErrorSchema } from './error.js';
import { JsonObjectSchema } from './json-schema.js';

/** 工作环境中的文件元数据。 */
export interface FileStat {
  kind: 'file' | 'dir';
  revision: string;
  description?: string;
}

export interface FileEntry {
  name: string;
  kind: 'file' | 'dir';
  description: string;
}

export interface FileWriteInput {
  content: string;
  /** undefined 无条件、null 仅创建、string 做 CAS。 */
  expectedRevision?: string | null;
}

/** Runtime 按当前 Agent 工作环境注入。 */
export interface FileAccess {
  inspect(path: string): Promise<Result<FileReadResult, KernelError>>;
  list(path: string): Promise<Result<readonly FileEntry[], KernelError>>;
  write(path: string, content: string, expectedRevision?: string | null): Promise<Result<FileWriteResult, KernelError>>;
}

export const FileReadResultSchema = z.object({
  content: z.string(),
  /** 实际文件后端提供大小、时间等已观察元数据 */
  metadata: JsonObjectSchema.optional(),
  /** 读取时的文件 revision，供后续文件写入做 CAS */
  revision: z.string(),
});
export type FileReadResult = z.infer<typeof FileReadResultSchema>;

export const FileWriteResultSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      output: z.string().optional(),
      /** 文件后端已确认的结果细节；与输出、revision 一同提交，不承载执行权限。 */
      metadata: JsonObjectSchema.optional(),
      revisionBefore: z.string().nullable(),
      revisionAfter: z.string(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: KernelErrorSchema,
    })
    .strict(),
]);
export type FileWriteResult = z.infer<typeof FileWriteResultSchema>;
