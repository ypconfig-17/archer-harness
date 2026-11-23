/** 确定性的轻量关键词检索；中文等连续文字补充相邻双字词。 */
import type { MemoryEntry, MemoryMatch } from './types.js';
function termsOf(query: string): string[] {
  const words = query.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms = new Set<string>();
  for (const word of words) {
    terms.add(word);
    for (const run of word.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) ?? []) {
      const chars = [...run];
      for (let index = 0; index + 1 < chars.length; index++) terms.add(chars[index] + chars[index + 1]);
    }
  }
  return [...terms].slice(0, 64);
}
export function searchEntries(entries: readonly MemoryEntry[], query: string, limit: number) {
  const terms = termsOf(query);
  const ranked = entries.map(entry => {
    const content = entry.content.normalize('NFKC').toLowerCase();
    const tags = entry.tags.join(' ').normalize('NFKC').toLowerCase();
    const score = terms.reduce((value, term) => value + (content.includes(term) ? 1 : 0) + (tags.includes(term) ? 2 : 0), 0);
    return { entry, score };
  }).filter(item => !query.trim() || terms.length > 0 && item.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.seq - a.entry.seq);
  let shortened = false;
  const matches: MemoryMatch[] = ranked.slice(0, limit).map(({ entry, score }) => {
    const content = entry.content.toLowerCase();
    const indexes = terms.map(term => content.indexOf(term)).filter(index => index >= 0);
    const start = Math.max(0, (indexes.length ? Math.min(...indexes) : 0) - 80);
    const end = Math.min(entry.content.length, start + 512);
    const truncated = start > 0 || end < entry.content.length;
    shortened ||= truncated;
    return { id: entry.id, excerpt: `${start ? '…' : ''}${entry.content.slice(start, end)}${end < entry.content.length ? '…' : ''}`,
      tags: entry.tags, ...(entry.source !== undefined ? { source: entry.source } : {}), createdAt: entry.createdAt, score,
    };
  });
  return { query, matches, total: ranked.length, truncated: ranked.length > matches.length || shortened };
}
