/** 记忆条目独立于 Agent 会话事实，序号只在所属命名空间内递增。 */
export interface MemoryEntry {
  seq: number;
  id: string;
  content: string;
  tags: string[];
  source?: string;
  createdAt: number;
}
export interface MemoryAppend {
  id: string;
  content: string;
  tags: string[];
  source?: string;
}
export interface MemoryMatch {
  id: string;
  excerpt: string;
  tags: string[];
  source?: string;
  createdAt: number;
  score: number;
}
