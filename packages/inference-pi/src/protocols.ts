/**
 * Archer Harness — pi-ai 可配置的线协议
 *
 * 只列出能用 apiKey、baseURL 与 headers 完整描述的协议。Bedrock 需要 AWS
 * 签名与区域，Vertex 需要项目、位置与 ADC，Azure 需要额外环境与 api-version，
 * Codex 走 OAuth；这些信息不在当前配置形态内，强行提供只会得到一个无法
 * 完成鉴权的 provider。目录 provider 仍可通过自身实现访问这些协议，限制
 * 只作用于显式声明协议的路由。
 */

import type { ProviderStreams } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';

/** 协议标识到 pi-ai 惰性实现的映射 */
export const PI_PROTOCOLS = {
  'openai-completions': openAICompletionsApi,
  'openai-responses': openAIResponsesApi,
  'anthropic-messages': anthropicMessagesApi,
} as const satisfies Record<string, () => ProviderStreams>;

export type PiProtocol = keyof typeof PI_PROTOCOLS;

/** Zod 枚举需要的非空元组 */
export const PI_PROTOCOL_IDS = Object.keys(PI_PROTOCOLS) as [
  PiProtocol,
  ...PiProtocol[],
];

/** 取得协议实现；每个 provider 构造时加载一次 */
export function protocolStreams(api: PiProtocol): ProviderStreams {
  return PI_PROTOCOLS[api]();
}
