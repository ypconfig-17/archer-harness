/** Provider 声明与本地接口分离；只有能力引用及元数据可进入事实。 */
import { z } from 'zod';
import { JsonValueSchema } from './json-schema.js';
import type { JsonObject, JsonValue, Snapshot } from './json.js';
import type { FileAccess } from './workspace-files.js';
import type { InferEffect, InferResult } from './effect.js';
import type { InferenceChunk } from './progress.js';
import type { SchemaDescriptor } from './schema.js';

export interface Contract<I = unknown, M extends object = JsonObject> {
  readonly id: string;
  readonly metadata: z.ZodType<M>;
  readonly methods: readonly (keyof I & string)[];
  /** 显式声明的可选方法；缺失表示能力不支持，非函数仍拒绝。 */
  readonly optionalMethods?: readonly (keyof I & string)[];
}
export interface Contribution<I = unknown, M extends object = JsonObject> {
  readonly contract: Contract<I, M>;
  readonly metadata: M;
  readonly implementation: I;
}
export interface Provider {
  readonly id: string;
  readonly identity: JsonObject;
  readonly capabilities: Readonly<Record<string, Contribution<any, any>>>;
  open?(context: { signal: AbortSignal }): Promise<void>;
  close?(): Promise<void>;
}
/** 宿主显式提供创建定义，容器可重建实例；工厂不进入日志或模型上下文。 */
export interface ProviderDefinition {
  readonly id: string;
  readonly create: (context: { signal: AbortSignal }) => Provider | Promise<Provider>;
}
export const CapabilityRefSchema = z.object({
  providerId: z.string().min(1), capabilityId: z.string().min(1),
  contractId: z.string().min(1), revision: z.string().min(1),
}).strict();
export type CapabilityRef = z.infer<typeof CapabilityRefSchema>;
export interface CapabilityDescriptor { readonly ref: CapabilityRef; readonly metadata: JsonObject }
export interface ProviderInfo { readonly id: string; readonly identity: JsonObject; readonly capabilities: readonly CapabilityDescriptor[] }
export interface Camp {
  readonly signal: AbortSignal;
  providers(): readonly ProviderInfo[];
  list<I, M extends object>(contract: Contract<I, M>): readonly (Omit<CapabilityDescriptor, 'metadata'> & { metadata: M })[];
  resolve<I, M extends object>(ref: CapabilityRef, contract: Contract<I, M>): I;
  /** 使用者必须在资源释放前结束借用；不改变资源所有权。 */
  acquire(): () => void;
  /** 重新创建并原子发布指定 Provider，失败不改变当前声明。 */
  refreshProvider(providerId: string): Promise<void>;
  close(): Promise<void>;
}
export interface OperationContext {
  readonly signal: AbortSignal;
  /** 当前调用的确定身份，只供能力读取本轮已提交历史，不进入模型消息。 */
  readonly call?: { readonly turnId: string; readonly target: CapabilityRef };
  readonly history?: import('./history.js').HistoryReader;
  readonly files?: FileAccess;
  readonly workspace?: import('./agent-session.js').Workspace;
  readonly inference?: Snapshot<Pick<InferEffect, 'messages' | 'config'>>;
}
export interface Tool { invoke(input: JsonValue, context: OperationContext): JsonValue | Promise<JsonValue> }
export interface Skill { load(context: OperationContext): SkillContent | Promise<SkillContent> }
export interface InferencePrepare { prepare(input: JsonValue, context: OperationContext): JsonValue | Promise<JsonValue> }
export const SkillContentSchema = z.object({ content: z.string(), revision: z.string().optional() }).strict();
export type SkillContent = z.infer<typeof SkillContentSchema>;
export const SKILL_CONTENT_MAX_BYTES = 65_536;
export interface ToolMetadata {
  description: string; inputSchema: SchemaDescriptor; execution: 'read' | 'write' | 'shell';
  /** 宿主界面用的简短说明，不进入模型声明；缺失时界面退回契约用途。 */
  summary?: string;
  interaction?: 'human'; resultView?: 'output';
}
export interface SkillMetadata {
  name: string; description: string;
  /** 宿主界面用的来源标识与技能目录；不进入模型声明。 */
  source?: string; path?: string;
  /** 技能包内 references/scripts/assets 的文件清单；正文始终由 load 返回。 */
  resources?: readonly SkillResource[];
  resourcesTruncated?: boolean;
}
export const SkillResourceSchema = z.object({ path: z.string().min(1), size: z.number().int().nonnegative() }).strict();
export type SkillResource = z.infer<typeof SkillResourceSchema>;
export interface PrepareMetadata { description: string; input: JsonValue; order?: number }
/** 完整模型输入的估算；估算值不是服务端精确计数。 */
export interface InferenceMeasurement {
  contextWindow: number;
  maxOutputTokens: number;
  estimatedInputTokens: number;
  method: string;
}
export interface Inference {
  /** 同步计量且不执行外部请求；相同模型和请求返回相同口径，追加完整消息不减少估算输入，供安全边界二分使用。 */
  measure?(effect: InferEffect): InferenceMeasurement | undefined;
  infer(effect: InferEffect, signal: AbortSignal, onProgress?: (chunk: InferenceChunk) => void): Promise<InferResult>;
}
export const PreparationSchema = z.object({ ref: CapabilityRefSchema, input: JsonValueSchema, order: z.number().optional() });
export type Preparation = z.infer<typeof PreparationSchema>;
