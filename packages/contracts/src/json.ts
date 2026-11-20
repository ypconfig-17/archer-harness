/**
 * Archer Harness — JSON 值与只读快照
 *
 * 跨进程与持久化数据只允许 JSON 标量、数组和普通对象。
 * 这里的函数负责边界校验、规范化比较以及快照隔离。
 */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonObject
  | readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** 深只读投影：数组与对象字段递归只读，标量保持原类型 */
export type Snapshot<T> = T extends readonly (infer E)[]
  ? readonly Snapshot<E>[]
  : T extends object
    ? { readonly [K in keyof T]: Snapshot<T[K]> }
    : T;

/** 判断值是否为合法 JSON 值；拒绝函数、Date、Map、BigInt、循环引用与非有限数 */
export function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
  if (value === null) return true;
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object':
      break;
    default:
      return false;
  }

  if (seen.has(value)) return false;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.every((item) => isJsonValue(item, seen));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Object.keys(value).every((key) =>
      isJsonValue((value as Record<string, unknown>)[key], seen),
    );
  } finally {
    seen.delete(value);
  }
}

/** 校验 JSON 值；失败抛出 TypeError，由调用方映射为领域错误 */
export function assertJsonValue(value: unknown, label: string): asserts value is JsonValue {
  if (!isJsonValue(value)) {
    throw new TypeError(`${label} 必须是可 JSON 序列化的值`);
  }
}

/** 规范化 JSON：对象键按字典序排列，用于稳定比较 */
export function canonicalJson(value: JsonValue): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object':
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
      }
      return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as JsonObject)[key])}`)
        .join(',')}}`;
  }
}

/** 深冻结一份快照；输入必须已经是纯 JSON 数据 */
export function freezeSnapshot<T>(value: T): Snapshot<T> {
  const clone = structuredClone(value);
  const deepFreeze = (target: unknown): void => {
    if (target === null || typeof target !== 'object') return;
    if (Object.isFrozen(target)) return;
    Object.freeze(target);
    for (const key of Object.keys(target)) {
      deepFreeze((target as Record<string, unknown>)[key]);
    }
  };
  deepFreeze(clone);
  return clone as Snapshot<T>;
}
