/**
 * pi-ai 推理端口：配置校验、路由与模型选择、凭据引用、请求映射与结果投影。
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { InferEffect, Message } from '@archer/contracts';
import {
  createPiInference,
  loadPiInference,
  parsePiConfig,
  resolvePiConfig,
  PiInferenceError,
} from '@archer/inference-pi';

interface RecordedRequest {
  url: string;
  headers: Headers;
  body: any;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** 记录请求并把响应交给测试提供者 */
function recordingFetch(
  respond: (request: RecordedRequest) => Response,
): { fetch: typeof globalThis.fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const text = await request.text();
    const recorded: RecordedRequest = {
      url: request.url,
      headers: request.headers,
      body: text.length === 0 ? undefined : JSON.parse(text),
    };
    requests.push(recorded);
    return respond(recorded);
  };
  return { fetch: fetchImpl, requests };
}

/** 生成 OpenAI Chat Completions 的 SSE 响应 */
function sseResponse(chunks: readonly unknown[]): Response {
  const payload = chunks
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join('') + 'data: [DONE]\n\n';
  return new Response(payload, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** 一段固定的文本回复事件流 */
function textStream(content: readonly string[], usage?: {
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): Response {
  const base = {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'test-model',
  };
  const chunks: unknown[] = content.map((text, index) => ({
    ...base,
    choices: [{
      index: 0,
      delta: index === 0 ? { role: 'assistant', content: text } : { content: text },
      finish_reason: null,
    }],
  }));
  chunks.push({
    ...base,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    ...(usage === undefined
      ? {}
      : {
          usage: {
            prompt_tokens: usage.promptTokens,
            completion_tokens: usage.completionTokens,
            total_tokens: usage.promptTokens + usage.completionTokens,
            prompt_tokens_details: { cached_tokens: usage.cacheReadTokens ?? 0, cache_write_tokens: usage.cacheWriteTokens ?? 0 },
          },
        }),
  });
  return sseResponse(chunks);
}

function inferEffect(
  messages: Message[],
  config?: InferEffect['config'],
): InferEffect {
  return { promptPrefixCount: 0, type: 'INFER', target: { providerId: 'inference', capabilityId: 'model', contractId: 'archer.inference@1', revision: 'test' }, messages, ...(config === undefined ? {} : { config }) };
}

/** 断言调用同步抛出带指定错误码的 PiInferenceError */
function expectConfigError(run: () => unknown, code: PiInferenceError['code']): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(PiInferenceError);
    expect((error as PiInferenceError).code).toBe(code);
    return;
  }
  throw new Error('预期抛出配置错误');
}

/** 断言 Promise 以带指定错误码的 PiInferenceError 拒绝 */
async function expectInferError(
  promise: Promise<unknown>,
  code: PiInferenceError['code'],
): Promise<PiInferenceError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PiInferenceError);
    expect((error as PiInferenceError).code).toBe(code);
    return error as PiInferenceError;
  }
  throw new Error('预期推理失败');
}

/** 一条可用的自定义路由；目录中没有该 provider */
function gateway(
  models: readonly string[],
  extra: Record<string, unknown> = {},
): { providers: Record<string, unknown> } {
  return {
    providers: {
      gateway: {
        api: 'openai-completions',
        baseURL: 'https://gateway.test/v1',
        apiKeyEnv: 'GATEWAY_KEY',
        models: models.map((id) => ({ id })),
        ...extra,
      },
    },
  };
}

describe('配置校验', () => {
  it('拒绝空 provider 集合', () => {
    expectConfigError(
      () => createPiInference({ providers: {} }),
      'CONFIG_INVALID',
    );
  });

  it('拒绝未知协议与未知字段', () => {
    expectConfigError(
      () => createPiInference({
        providers: {
          local: {
            api: 'not-a-protocol',
            baseURL: 'https://local.test/v1',
            models: [{ id: 'm' }],
          },
        },
      }),
      'CONFIG_INVALID',
    );
    expectConfigError(
      () => createPiInference({
        providers: {
          local: {
            api: 'openai-completions',
            baseURL: 'https://local.test/v1',
            models: [{ id: 'm' }],
            unknown: true,
          },
        },
      }),
      'CONFIG_INVALID',
    );
  });

  it('要求非目录 provider 声明 api', () => {
    expectConfigError(
      () => createPiInference({
        providers: {
          local: {
            baseURL: 'https://local.test/v1',
            models: [{ id: 'm' }],
          },
        },
      }),
      'CONFIG_INVALID',
    );
  });

  it('校验 defaultProvider 与 defaultModel 的引用', () => {
    expectConfigError(
      () => createPiInference({ ...gateway(['m']), defaultProvider: 'missing' }),
      'CONFIG_INVALID',
    );
    expectConfigError(
      () => createPiInference(gateway(['m'], { defaultModel: 'missing' })),
      'CONFIG_INVALID',
    );
  });

  it('目录 provider 无需声明模型即可解析', () => {
    const inference = createPiInference({
      providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY' } },
    });
    expect(inference.providers).toEqual(['openai']);
  });
});

describe('路由与模型选择', () => {
  it('多个 provider 且无默认值或显式选择时拒绝', async () => {
    const { fetch, requests } = recordingFetch(() => textStream(['ignored']));
    const inference = createPiInference({
      providers: {
        alpha: {
          api: 'openai-completions',
          baseURL: 'https://alpha.test/v1',
          apiKeyEnv: 'ALPHA_KEY',
          models: [{ id: 'a' }],
        },
        beta: {
          api: 'openai-completions',
          baseURL: 'https://beta.test/v1',
          apiKeyEnv: 'BETA_KEY',
          models: [{ id: 'b' }],
        },
      },
    }, { env: { ALPHA_KEY: 'a', BETA_KEY: 'b' }, fetch });

    await expectInferError(
      inference.infer(inferEffect([{ role: 'user', content: 'hi' }]), new AbortController().signal),
      'PROVIDER_REQUIRED',
    );
    expect(requests).toHaveLength(0);
  });

  it('配置的 defaultProvider 生效', async () => {
    const { fetch, requests } = recordingFetch(() => textStream(['ok']));
    const inference = createPiInference({
      defaultProvider: 'beta',
      providers: {
        alpha: {
          api: 'openai-completions',
          baseURL: 'https://alpha.test/v1',
          apiKeyEnv: 'ALPHA_KEY',
          models: [{ id: 'a' }],
        },
        beta: {
          api: 'openai-completions',
          baseURL: 'https://beta.test/v1',
          apiKeyEnv: 'BETA_KEY',
          models: [{ id: 'b' }],
          defaultModel: 'b',
        },
      },
    }, { env: { ALPHA_KEY: 'a', BETA_KEY: 'b' }, fetch });

    await inference.infer(
      inferEffect([{ role: 'user', content: 'hi' }]),
      new AbortController().signal,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://beta.test/v1/chat/completions');
  });

  it('唯一模型可跨 provider 推断，重复模型要求显式 provider', async () => {
    const { fetch } = recordingFetch(() => textStream(['ok']));
    const inference = createPiInference({
      providers: {
        alpha: {
          api: 'openai-completions',
          baseURL: 'https://alpha.test/v1',
          apiKeyEnv: 'ALPHA_KEY',
          models: [{ id: 'a' }],
        },
        beta: {
          api: 'openai-completions',
          baseURL: 'https://beta.test/v1',
          apiKeyEnv: 'BETA_KEY',
          models: [{ id: 'b' }],
        },
      },
    }, { env: { ALPHA_KEY: 'a', BETA_KEY: 'b' }, fetch });

    const result = await inference.infer(
      inferEffect([{ role: 'user', content: 'hi' }], { model: 'b' }),
      new AbortController().signal,
    );
    expect(result.content).toBe('ok');

    const duplicated = createPiInference({
      providers: {
        alpha: {
          api: 'openai-completions',
          baseURL: 'https://alpha.test/v1',
          apiKeyEnv: 'ALPHA_KEY',
          models: [{ id: 'shared' }],
        },
        beta: {
          api: 'openai-completions',
          baseURL: 'https://beta.test/v1',
          apiKeyEnv: 'BETA_KEY',
          models: [{ id: 'shared' }],
        },
      },
    }, { env: { ALPHA_KEY: 'a', BETA_KEY: 'b' }, fetch });

    await expectInferError(
      duplicated.infer(
        inferEffect([{ role: 'user', content: 'hi' }], { model: 'shared' }),
        new AbortController().signal,
      ),
      'PROVIDER_REQUIRED',
    );
  });

  it('拒绝未知 provider 与未知模型', async () => {
    const { fetch, requests } = recordingFetch(() => textStream(['ok']));
    const inference = createPiInference(gateway(['a', 'b']), {
      env: { GATEWAY_KEY: 'key' },
      fetch,
    });

    await expectInferError(
      inference.infer(
        inferEffect([{ role: 'user', content: 'hi' }], { provider: 'missing' }),
        new AbortController().signal,
      ),
      'UNKNOWN_PROVIDER',
    );
    await expectInferError(
      inference.infer(
        inferEffect([{ role: 'user', content: 'hi' }], { model: 'missing' }),
        new AbortController().signal,
      ),
      'UNKNOWN_MODEL',
    );
    expect(requests).toHaveLength(0);
  });

  it('多个模型且无默认模型时拒绝', async () => {
    const { fetch } = recordingFetch(() => textStream(['ok']));
    const inference = createPiInference(gateway(['a', 'b']), {
      env: { GATEWAY_KEY: 'key' },
      fetch,
    });

    await expectInferError(
      inference.infer(
        inferEffect([{ role: 'user', content: 'hi' }]),
        new AbortController().signal,
      ),
      'MODEL_REQUIRED',
    );
  });
});

describe('凭据与取消', () => {
  it('按模型实际地址选择桌面密钥，无匹配时继续使用显式环境变量', async () => {
    const { fetch, requests } = recordingFetch(() => textStream(['ok']));
    const resolveApiKey = async (provider: string, address: string): Promise<string | undefined> => (
      provider === 'gateway' && address === 'https://gateway.test/v1' ? 'desktop-test-key' : undefined
    );
    const options = { env: { GATEWAY_KEY: 'env-test-key' }, fetch, resolveApiKey };
    const effect = inferEffect([{ role: 'user', content: 'hi' }]);
    const signal = new AbortController().signal;

    await createPiInference(gateway(['m']), options).infer(effect, signal);
    await createPiInference(gateway(['m'], { baseURL: 'https://other.test/v1' }), options).infer(effect, signal);

    expect(requests.map(request => [request.url, request.headers.get('authorization')])).toEqual([
      ['https://gateway.test/v1/chat/completions', 'Bearer desktop-test-key'],
      ['https://other.test/v1/chat/completions', 'Bearer env-test-key'],
    ]);
  });

  it('内置目录地址同样按实际地址使用本机密钥，无需声明环境变量', async () => {
    const { fetch, requests } = recordingFetch(() => textStream(['ok']));
    const resolveApiKey = async (provider: string, address: string): Promise<string | undefined> => (
      provider === 'deepseek' && address === 'https://api.deepseek.com' ? 'desktop-catalog-key' : undefined
    );
    const inference = createPiInference(
      { providers: { deepseek: { models: [{ id: 'deepseek-flash' }] } } },
      { env: {}, fetch, resolveApiKey },
    );

    await inference.infer(inferEffect([{ role: 'user', content: 'hi' }]), new AbortController().signal);

    expect(requests.map(request => [request.url, request.headers.get('authorization')])).toEqual([
      ['https://api.deepseek.com/chat/completions', 'Bearer desktop-catalog-key'],
    ]);
  });

  it('凭据引用缺失时在发出请求前失败', async () => {
    const { fetch, requests } = recordingFetch(() => textStream(['ok']));
    const inference = createPiInference(gateway(['m'], { defaultModel: 'm' }), {
      env: {},
      fetch,
    });

    await expectInferError(
      inference.infer(
        inferEffect([{ role: 'user', content: 'hi' }]),
        new AbortController().signal,
      ),
      'MISSING_CREDENTIAL',
    );
    expect(requests).toHaveLength(0);
  });

  it('已取消的信号不会发出请求', async () => {
    const { fetch, requests } = recordingFetch(() => textStream(['ok']));
    const inference = createPiInference(gateway(['m'], { defaultModel: 'm' }), {
      env: { GATEWAY_KEY: 'key' },
      fetch,
    });
    const controller = new AbortController();
    controller.abort();

    await expectInferError(
      inference.infer(
        inferEffect([{ role: 'user', content: 'hi' }]),
        controller.signal,
      ),
      'ABORTED',
    );
    expect(requests).toHaveLength(0);
  });
});

describe('请求映射与结果投影', () => {
  it('把消息、采样参数与请求头映射为 pi-ai 调用', async () => {
    const { fetch, requests } = recordingFetch(() => textStream(['Hello ', 'world'], {
      promptTokens: 11,
      completionTokens: 2,
    }));
    const inference = createPiInference(gateway(['test-model'], {
      defaultModel: 'test-model',
      headers: { 'x-tenant': 'archer' },
    }), { env: { GATEWAY_KEY: 'sk-secret' }, fetch });

    const result = await inference.infer(inferEffect([
      { role: 'system', content: 'You are Archer.' },
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'again' },
    ], { temperature: 0.2, maxTokens: 64 }), new AbortController().signal);

    expect(result).toEqual({
      content: 'Hello world',
      stopReason: 'stop',
      reasoningLevel: 'off',
      toolCalls: [],
      usage: { promptTokens: 11, completionTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
    });
    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.url).toBe('https://gateway.test/v1/chat/completions');
    expect(request?.headers.get('authorization')).toBe('Bearer sk-secret');
    expect(request?.headers.get('x-tenant')).toBe('archer');
    expect(request?.body.messages).toEqual([
      { role: 'system', content: 'You are Archer.\n\nBe concise.' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'again' },
    ]);
    expect(request?.body.temperature).toBe(0.2);
    expect(request?.body.max_completion_tokens).toBe(64);
    expect(request?.body.stream_options).toEqual({ include_usage: true });
  });

  it('provider 错误会移除已解析的凭据值', async () => {
    const { fetch } = recordingFetch(() => new Response(
      JSON.stringify({
        error: {
          message: 'Incorrect API key provided: sk-secret',
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
      }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    ));
    const inference = createPiInference(gateway(['m'], { defaultModel: 'm' }), {
      env: { GATEWAY_KEY: 'sk-secret' },
      fetch,
    });

    const error = await expectInferError(
      inference.infer(
        inferEffect([{ role: 'user', content: 'hi' }]),
        new AbortController().signal,
      ),
      'PROVIDER_ERROR',
    );
    expect(error.message).not.toContain('sk-secret');
    expect(error.message).toContain('[已隐藏]');
  });
});

describe('配置文件加载', () => {
  it('读取 JSON 配置并映射解析错误', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archer-inference-pi-'));
    tempDirs.push(dir);
    const path = join(dir, 'ai.json');
    await writeFile(path, JSON.stringify(gateway(['m'], { defaultModel: 'm' })));

    const { fetch } = recordingFetch(() => textStream(['ok']));
    const inference = await loadPiInference(path, {
      env: { GATEWAY_KEY: 'key' },
      fetch,
    });
    await expect(inference.infer(
      inferEffect([{ role: 'user', content: 'hi' }]),
      new AbortController().signal,
    )).resolves.toMatchObject({ content: 'ok' });

    await expectInferError(loadPiInference(join(dir, 'missing.json')), 'CONFIG_INVALID');
    await writeFile(path, '{');
    await expectInferError(loadPiInference(path), 'CONFIG_INVALID');
  });
});

it('通过端口发布累计正文进度，最终结果与进度回调相互独立', async () => {
  const network = recordingFetch(() => textStream(['{"message":"', 'Hello', ' world"}']));
  const port = createPiInference(gateway(['test-model']), { env: { GATEWAY_KEY: 'key' }, fetch: network.fetch });
  const frames: string[] = [];
  const result = await port.infer(inferEffect([{ role: 'user', content: 'Reply.' }]), new AbortController().signal, frame => { frames.push(frame.content); });
  expect(frames).toContain('{"message":"Hello');
  expect(result.content).toBe('{"message":"Hello world"}');
  const ignored = await port.infer(inferEffect([{ role: 'user', content: 'Reply.' }]), new AbortController().signal, () => { throw new Error('display disconnected'); });
  expect(ignored.content).toBe(result.content);
});

it('原生工具定义、流式参数、调用 ID 与工具结果在 provider 协议中完整往返', async () => {
  let requestsMade = 0;
  const { fetch, requests } = recordingFetch(() => {
    if (requestsMade++ > 0) return textStream(['Saved.']);
    const base = { id: 'chatcmpl-tool', object: 'chat.completion.chunk', created: 1, model: 'test-model' };
    return sseResponse([
      { ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_memory', type: 'function', function: { name: 'append_memory', arguments: '{"content":' } }] }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"中文回答"}' } }] }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]);
  });
  const inference = createPiInference(gateway(['test-model'], { defaultModel: 'test-model' }), { env: { GATEWAY_KEY: 'test-key' }, fetch });
  const effect: InferEffect = { promptPrefixCount: 0, type: 'INFER', target: { providerId: 'inference', capabilityId: 'model', contractId: 'archer.inference@1', revision: 'test' }, messages: [{ role: 'user', content: 'Remember my preference.' }], tools: [{ name: 'append_memory', target: { providerId: 'test', capabilityId: 'operation', contractId: 'archer.tool@1', revision: 'test-source' }, description: 'Append memory.', parameters: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] } }] };
  const result = await inference.infer(effect, new AbortController().signal);
  expect(result.toolCalls).toEqual([{ id: 'call_memory', name: 'append_memory', input: { content: '中文回答' } }]);
  expect(requests[0]!.body.tools).toMatchObject([{ type: 'function', function: { name: 'append_memory', parameters: { required: ['content'] } } }]);
  expect(JSON.stringify(requests[0]!.body)).not.toContain('providerId');
  expect(requests[0]!.body.tools[0].function).not.toHaveProperty('target');
  expect(requests[0]!.body.tools[0].function).not.toHaveProperty('contractId');
  await inference.infer({ ...effect, messages: [...effect.messages, { role: 'assistant', content: result.content, toolCalls: result.toolCalls }, { role: 'tool', content: '{"saved":true}', toolCallId: 'call_memory', toolName: 'append_memory' }] }, new AbortController().signal);
  expect(requests[1]!.body.messages).toContainEqual(expect.objectContaining({ role: 'tool', tool_call_id: 'call_memory', content: '{"saved":true}' }));
  expect(requests[1]!.body.messages.find((message: any) => message.role === 'assistant').tool_calls).toMatchObject([{ id: 'call_memory', function: { name: 'append_memory' } }]);
});

it('原生长度截断保留原因，部分工具参数不会进入可执行结果', async () => {
  const { fetch } = recordingFetch(() => sseResponse([
    { id: 'limited', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'Partial', tool_calls: [{ index: 0, id: 'partial-call', type: 'function', function: { name: 'write', arguments: '{"content":' } }] }, finish_reason: null }] },
    { id: 'limited', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta: {}, finish_reason: 'length' }] },
  ]));
  const inference = createPiInference(gateway(['test-model'], { defaultModel: 'test-model' }), { env: { GATEWAY_KEY: 'test-key' }, fetch });
  const result = await inference.infer(inferEffect([{ role: 'user', content: 'Write.' }]), new AbortController().signal);
  expect(result).toMatchObject({ content: 'Partial', stopReason: 'length', toolCalls: [] });
});

it('按模型返回真实支持等级，模型默认值优先于服务默认值，不支持的配置明确拒绝', () => {
  const config = { providers: { deepseek: { models: [{ id: 'deepseek-flash', defaultReasoning: 'low' }], reasoning: 'high' } } };
  const route = resolvePiConfig(parsePiConfig(config)).routes[0]!;
  expect(route.modelReasoning['deepseek-flash']).toEqual({ levels: ['off', 'low', 'high', 'max'], default: 'low' });
  expect(() => resolvePiConfig(parsePiConfig({ providers: { deepseek: { models: [{ id: 'deepseek-flash', defaultReasoning: 'medium' }] } } }))).toThrow('不支持默认推理等级');
  expect(() => resolvePiConfig(parsePiConfig({ providers: { deepseek: { models: [{ id: 'deepseek-flash', reasoningLevels: ['off', 'xhigh'] }] } } }))).toThrow('实际支持范围');
});
it('DeepSeek 默认开启实际支持的推理等级，关闭显式生效，非法等级不发请求', async () => {
  const { fetch, requests } = recordingFetch(() => textStream(['Done.']));
  const inference = createPiInference({ providers: { deepseek: { models: [{ id: 'deepseek-flash' }], apiKeyEnv: 'DEEPSEEK_TEST_KEY' } } }, { env: { DEEPSEEK_TEST_KEY: 'test-key' }, fetch });
  expect(await inference.infer(inferEffect([{ role: 'user', content: 'Analyze.' }]), new AbortController().signal)).toMatchObject({ reasoningLevel: 'high' });
  expect(requests[0]!.body).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'high' });
  await inference.infer(inferEffect([{ role: 'user', content: 'Answer.' }], { reasoning: 'off' }), new AbortController().signal);
  expect(requests[1]!.body.thinking).toEqual({ type: 'disabled' });
  await expect(inference.infer(inferEffect([{ role: 'user', content: 'Answer.' }], { reasoning: 'medium' }), new AbortController().signal)).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  expect(requests).toHaveLength(2);
});
it('原生思考文本及签名按原范围回传，同模型工具轮次保持协议上下文', async () => {
  let round = 0;
  const { fetch, requests } = recordingFetch(() => round++ === 0 ? sseResponse([
    { id: 'reasoning-call', object: 'chat.completion.chunk', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: 'Native reasoning text.' }, finish_reason: null }] },
    { id: 'reasoning-call', object: 'chat.completion.chunk', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'read-call', type: 'function', function: { name: 'read_file', arguments: '{"path":"main.ts"}' } }] }, finish_reason: 'tool_calls' }] },
  ]) : textStream(['Done.']));
  const inference = createPiInference({ providers: { deepseek: { models: [{ id: 'deepseek-flash' }], apiKeyEnv: 'DEEPSEEK_TEST_KEY' } } }, { env: { DEEPSEEK_TEST_KEY: 'test-key' }, fetch });
  const first = inferEffect([{ role: 'user', content: 'Analyze.' }]);
  const result = await inference.infer(first, new AbortController().signal);
  expect(result.reasoning).toBe('Native reasoning text.');
  expect(result.reasoningReplay).toMatchObject({ provider: 'deepseek', model: 'deepseek-flash', blocks: [{ start: 0, end: 22, signature: 'reasoning_content' }] });
  await inference.infer({ ...first, messages: [...first.messages, { role: 'assistant', content: result.content, toolCalls: result.toolCalls, reasoning: result.reasoning, reasoningReplay: result.reasoningReplay }, { role: 'tool', content: 'Source.', toolCallId: 'read-call', toolName: 'read_file' }] }, new AbortController().signal);
  expect(requests[1]!.body.messages.find((message: any) => message.role === 'assistant').reasoning_content).toBe('Native reasoning text.');
});

it('缓存读写属于输入的子集，不重复计入总量', async () => {
  const { fetch } = recordingFetch(() => textStream(['Done.'], { promptTokens: 100, completionTokens: 5, cacheReadTokens: 60, cacheWriteTokens: 10 }));
  const inference = createPiInference(gateway(['test-model'], { defaultModel: 'test-model' }), { env: { GATEWAY_KEY: 'test' }, fetch });
  const result = await inference.infer(inferEffect([{ role: 'user', content: 'Hello' }]), new AbortController().signal);
  expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 5, cacheReadTokens: 60, cacheWriteTokens: 10 });
});

it('服务未回传用量时不把 SDK 的全零占位当成零消耗', async () => {
  const { fetch } = recordingFetch(() => textStream(['Done.']));
  const inference = createPiInference(gateway(['test-model'], { defaultModel: 'test-model' }), { env: { GATEWAY_KEY: 'test' }, fetch });
  const result = await inference.infer(inferEffect([{ role: 'user', content: 'Hello' }]), new AbortController().signal);
  expect(result.usage).toBeUndefined();
});

it('窗口估算覆盖系统、消息和工具，不解析凭据或发送网络请求', () => {
  const inference = createPiInference(gateway(['m']), { env: {} });
  const base: InferEffect = { type: 'INFER', target: { providerId: 'p', capabilityId: 'c', contractId: 'archer.inference@1', revision: 'r' }, messages: [{ role: 'user', content: 'Hello.' }], promptPrefixCount: 0 };
  const first = inference.measure!(base)!;
  expect(first.contextWindow).toBeGreaterThan(0);
  expect(first.maxOutputTokens).toBeGreaterThan(0);
  const enriched = inference.measure!({ ...base, messages: [{ role: 'system', content: 'Rules '.repeat(100) }, ...base.messages], tools: [{ name: 'read', description: 'Read '.repeat(100), parameters: { type: 'object' }, target: base.target }] })!;
  expect(enriched.estimatedInputTokens).toBeGreaterThan(first.estimatedInputTokens + 200);
  expect(enriched.method).toBe('pi-context-token-classes-v1');
});

it('估算按字符类别折算，中文不再按 UTF-8 字节放大三倍', () => {
  const inference = createPiInference(gateway(['m']), { env: {} });
  const target = { providerId: 'p', capabilityId: 'c', contractId: 'archer.inference@1', revision: 'r' };
  const measure = (content: string) => inference.measure!({ type: 'INFER', target, messages: [{ role: 'user', content }], promptPrefixCount: 0 })!.estimatedInputTokens;
  const ascii = measure('a'.repeat(4000));
  const cjk = measure('中'.repeat(4000));
  expect(cjk).toBeGreaterThan(ascii);
  expect(cjk).toBeLessThan(6000);
});
