/** 持久化记忆 Provider；独立维护记忆日志，不管理 Agent 调度。 */
import { isAbsolute, resolve } from 'node:path';
import type { JsonObject, JsonValue, SchemaDescriptor } from '@archer/contracts';
import { ArcherError, OperationRejected, validateInput, freezeSnapshot } from '@archer/contracts';
import { provider, tool, offer, INFERENCE_PREPARE } from '@archer/camp';
import { MemoryStore, normalizeAppend } from './store.js';
import { searchEntries } from './search.js';
import { APPEND_DESCRIPTION, SEARCH_DESCRIPTION, GET_DESCRIPTION, CONTEXT_DESCRIPTION,
  APPEND_SUMMARY, SEARCH_SUMMARY, GET_SUMMARY,
  APPEND_SCHEMA, GET_SCHEMA, SEARCH_SCHEMA, CONTEXT_SCHEMA } from './prompt.js';
export type { MemoryEntry, MemoryAppend, MemoryMatch } from './types.js';
function configOf(config: JsonObject) {
  if (Object.keys(config).some(key => !['directory', 'namespace'].includes(key))
    || typeof config.directory !== 'string' || !isAbsolute(config.directory)
    || typeof config.namespace !== 'string' || !config.namespace.trim() || config.namespace.length > 256) {
    throw new ArcherError('INVALID_ARGUMENT', 'Memory config requires an absolute directory and an explicit non-empty namespace; unknown fields are not supported.');
  }
  return { directory: resolve(config.directory), namespace: config.namespace };
}
function inputOf(schema: SchemaDescriptor, input: JsonValue): JsonObject {
  try { validateInput(schema, input); }
  catch { throw new OperationRejected('Memory input does not match the capability schema.', 'INVALID_ARGUMENT'); }
  return input as JsonObject;
}

export function memoryProvider(config: JsonObject, id = 'memory') {
  const { directory, namespace } = configOf(config);
  const store = new MemoryStore(directory, namespace);
  return provider(id, {
    append: tool({ description: APPEND_DESCRIPTION, summary: APPEND_SUMMARY, inputSchema: APPEND_SCHEMA, execution: 'write', invoke: async (input, context) => {
        const value = inputOf(APPEND_SCHEMA, input);
        const normalized = normalizeAppend({ id: value.id as string, content: value.content as string,
          tags: (value.tags ?? []) as string[], ...(value.source !== undefined ? { source: value.source as string } : {}),
        });
        return freezeSnapshot({ namespace, ...await store.append(normalized, context.signal) });
      } }),
    get: tool({ description: GET_DESCRIPTION, summary: GET_SUMMARY, inputSchema: GET_SCHEMA, execution: 'read', invoke: async (input, context) => {
        const value = inputOf(GET_SCHEMA, input);
        const entry = (await store.entries(context.signal)).find(entry => entry.id === value.id) ?? null;
        return freezeSnapshot({ namespace, entry });
      } }),
    search: tool({ description: SEARCH_DESCRIPTION, summary: SEARCH_SUMMARY, inputSchema: SEARCH_SCHEMA, execution: 'read', invoke: async (input, context) => {
        const value = inputOf(SEARCH_SCHEMA, input);
        return freezeSnapshot({ namespace, ...searchEntries(await store.entries(context.signal), value.query as string ?? '', value.limit as number ?? 5) });
      } }),
    context: offer(INFERENCE_PREPARE, { description: CONTEXT_DESCRIPTION, input: { limit: 10 } }, { prepare: async (input, context) => {
        const value = inputOf(CONTEXT_SCHEMA, input);
        const dynamic = [...context.inference?.messages ?? []].reverse().find(message => message.role === 'user')?.content;
        if (value.query === undefined && dynamic === undefined) {
          throw new OperationRejected('Context retrieval requires inference messages or an explicit query.', 'INVALID_ARGUMENT');
        }
        const query = value.query as string | undefined ?? [...dynamic!].slice(0, 512).join('');
        const entries = await store.entries(context.signal);
        // 没有查询时不把无关的近期记忆自动注入模型。
        const result = query.trim()
          ? searchEntries(entries, query, value.limit as number ?? 5)
          : { query, matches: [], total: 0, truncated: false };
        // 为 Runtime 的安排元数据预留空间；缩减参考条目时显式标记截断。
        while (Buffer.byteLength(JSON.stringify({ namespace, ...result }), 'utf8') > 49_152 && result.matches.length) {
          result.matches.pop();
          result.truncated = true;
        }
        return freezeSnapshot({ namespace, ...result });
      } }),
  }, { identity: { directory, namespace, format: 1 }, open: ({ signal }) => store.open(signal), close: () => store.close() });
}
