/**
 * Archer Harness — JSON 值的 Zod schema
 *
 * 与 json.ts 的运行时校验保持一致：只接受有限数、普通对象、
 * 数组和 JSON 标量，用于Provider identity、错误详情等跨边界数据。
 */

import { z } from 'zod';
import type { JsonObject, JsonValue } from './json.js';

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().refine(Number.isFinite, 'JSON 数值必须是有限数'),
    z.string(),
    z.array(JsonValueSchema),
    JsonObjectSchema,
  ]),
);

export const JsonObjectSchema: z.ZodType<JsonObject> = z.lazy(() =>
  z.record(z.string(), JsonValueSchema),
);
