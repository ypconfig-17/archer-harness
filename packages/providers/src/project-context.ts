/** 项目参考只读取固定文档和根目录索引，不导入或执行工作区代码。 */
import { provider, offer, INFERENCE_PREPARE } from '@archer/camp';
import type { JsonObject, JsonValue } from '@archer/contracts';
/**
 * 单文档预算 16 KiB：根约定与 README 通常在该范围内，保证全文进入本次参考而不是截断。
 * 总预算 56 KiB = 3 × 16 KiB 文档 + 8 KiB 根索引与告警余量；
 * 仍低于 Handler 单次准备结果的 64 KiB 上限，不改变推理侧准入边界。
 */
const MAX_RESULT_BYTES = 57_344;
const MAX_DOCUMENT_BYTES = 16_384;
const DOCUMENTS = ['AGENTS.md', 'README.md', 'package.json'] as const;

/** 按 JSON 编码后的 UTF-8 大小截取完整字符，预算包含转义成本。 */
function excerpt(content: string, maxBytes: number): string {
  let bytes = 2;
  let result = '';
  for (const char of content) {
    const cost = Buffer.byteLength(JSON.stringify(char), 'utf8') - 2;
    if (bytes + cost > maxBytes) break;
    bytes += cost;
    result += char;
  }
  return result;
}

export function projectContextProvider() {
  return provider('project', {
    context: offer(INFERENCE_PREPARE, { description: '读取有界的项目说明与根条目。', input: {}, order: -100 }, {
      prepare: async (_input, context): Promise<JsonValue> => {
        if (context.signal.aborted) throw context.signal.reason;
        if (!context.files || !context.workspace) return { status: 'no-workspace', files: [], entries: [], warnings: [] };
        const files: JsonObject[] = [];
        const warnings: JsonObject[] = [];
        const listing = await context.files.list('');
        if (context.signal.aborted) throw context.signal.reason;
        if (!listing.ok) return { status: 'unavailable', files, entries: [], warnings: [{ message: excerpt(listing.error.message, 512) }] };
        const sorted = [...listing.value].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
        const entries: JsonObject[] = [];
        for (const entry of sorted) {
          const next = { name: entry.name, kind: entry.kind };
          if (entries.length === 64 || Buffer.byteLength(JSON.stringify([...entries, next]), 'utf8') > 4_096) break;
          entries.push(next);
        }
        for (const path of DOCUMENTS) {
          if (!sorted.some(entry => entry.name === path && entry.kind === 'file')) continue;
          if (context.signal.aborted) throw context.signal.reason;
          const result = await context.files.inspect(path);
          if (context.signal.aborted) throw context.signal.reason;
          if (!result.ok) { warnings.push({ path, message: excerpt(result.error.message, 512) }); continue; }
          const content = excerpt(result.value.content, MAX_DOCUMENT_BYTES);
          files.push({ path, revision: result.value.revision, content, truncated: content !== result.value.content });
        }
        const result = { status: 'ready', files, entries, entriesOmitted: sorted.length - entries.length, warnings };
        if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_RESULT_BYTES) throw new Error('Project context exceeds its serialized byte budget.');
        return result;
      },
    }),
  }, { identity: { implementation: 'project-reference', revision: 1 } });
}
