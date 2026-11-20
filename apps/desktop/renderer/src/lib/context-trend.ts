import { contextComposition, type CompositionKey } from './context-composition';
import type { ContextRequest } from './context-requests';

export interface TrendSegment {
  key: CompositionKey;
  share: number;
}

export interface TrendPoint {
  key: string;
  requestIndex: number;
  label: string;
  tokens?: number;
  segments: TrendSegment[];
}

export interface ContextTrend {
  points: TrendPoint[];
  max: number;
}

/**
 * 趋势只把已提交 usage 的输入 Token 画成柱高，分段沿用请求快照的字符占比。
 * usage 缺失的请求保留位置但不画柱，避免用 0 冒充真实用量；
 * limit 为 0 表示全部，窗口始终锚定在最新请求，随事件追加自然右移。
 */
export function contextTrend(requests: readonly ContextRequest[], limit: number): ContextTrend {
  const start = limit > 0 ? Math.max(0, requests.length - limit) : 0;
  const points = requests.slice(start).map((request, position) => ({
    key: request.key,
    requestIndex: start + position,
    label: `#${start + position + 1}`,
    tokens: request.usage?.promptTokens,
    segments: contextComposition(request).map(slice => ({ key: slice.key, share: slice.share })),
  }));
  const max = Math.max(0, ...points.map(point => point.tokens ?? 0));
  return { points, max };
}

/** 坐标轴只表达量级，保留整数或一位小数，避免刻度行被撑宽。 */
export function compactTokens(value: number): string {
  if (value < 1_000) return String(value);
  const scaled = value / 1_000;
  return `${Number.isInteger(scaled) ? scaled : scaled.toFixed(1)}K`;
}