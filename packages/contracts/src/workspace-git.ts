/**
 * 工作区 Git 读取协议。
 *
 * 该视图描述显式选择的 HEAD、暂存区与工作区差异，属于当前 Git 状态；
 * 不与已提交的任务事实、工具回执或审阅记录共用来源。
 */

import { z } from 'zod';

/** Git 工作区文件状态；重命名与复制保留前一个路径。 */
export const WorkspaceGitFileSchema = z.object({
  path: z.string().min(1),
  /** 重命名或复制前的仓库相对路径；普通修改没有该字段。 */
  previousPath: z.string().min(1).optional(),
  status: z.enum([
    'modified',
    'added',
    'deleted',
    'renamed',
    'copied',
    'untracked',
    'conflicted',
    'typechange',
  ]),
  /** 暂存区存在该文件的改动。 */
  staged: z.boolean(),
  /** 工作区存在未暂存改动；未跟踪文件为 true。 */
  workingTree: z.boolean(),
  binary: z.boolean(),
  /** 文件超过读取上限，内容不完整时不提供原文。 */
  truncated: z.boolean(),
  /** 修改前内容；缺省表示无法读取，空字符串表示已确认没有内容。 */
  before: z.string().optional(),
  /** 修改后内容；缺省表示无法读取，空字符串表示文件已删除。 */
  after: z.string().optional(),
}).strict();
export type WorkspaceGitFile = z.infer<typeof WorkspaceGitFileSchema>;

export const WorkspaceGitChangesSchema = z.discriminatedUnion('available', [
  z.object({
    available: z.literal(false),
    reason: z.enum(['no-workspace', 'not-a-repository', 'git-unavailable', 'read-failed']),
    detail: z.string().min(1),
  }).strict(),
  z.object({
    available: z.literal(true),
    /** Git 仓库根目录，可能高于会话工作区目录。 */
    root: z.string().min(1),
    /** 当前分支；分离 HEAD 或尚未提交时缺省。 */
    branch: z.string().min(1).optional(),
    files: z.array(WorkspaceGitFileSchema),
    /** 超出单次读取上限而未列出的文件数。 */
    omitted: z.number().int().nonnegative(),
  }).strict(),
]);
export type WorkspaceGitChanges = z.infer<typeof WorkspaceGitChangesSchema>;
