/**
 * 统一校验模块测试：查询参数解析与 Effect 结果校验。
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIST_LIMIT,
  EffectSchema,
  MAX_AGENT_EVENT_LIMIT,
  MAX_LIST_LIMIT,
  parseAfterSeqQuery,
  parseLimitQuery,
  validateEffectResult,
} from '@archer/contracts';

describe('parseAfterSeqQuery', () => {
  it('缺省与非法输入回退为 0', () => {
    expect(parseAfterSeqQuery(undefined)).toBe(0);
    expect(parseAfterSeqQuery(null)).toBe(0);
    expect(parseAfterSeqQuery('')).toBe(0);
    expect(parseAfterSeqQuery('abc')).toBe(0);
    expect(parseAfterSeqQuery('-3')).toBe(0);
    expect(parseAfterSeqQuery('Infinity')).toBe(0);
  });

  it('有效值向下取整，表示严格大于该 seq', () => {
    expect(parseAfterSeqQuery('0')).toBe(0);
    expect(parseAfterSeqQuery('7')).toBe(7);
    expect(parseAfterSeqQuery('7.9')).toBe(7);
  });
});

describe('parseLimitQuery', () => {
  it('缺省与非法输入回退为默认值', () => {
    expect(parseLimitQuery(undefined)).toBe(DEFAULT_LIST_LIMIT);
    expect(parseLimitQuery('abc')).toBe(DEFAULT_LIST_LIMIT);
    expect(parseLimitQuery('', 10)).toBe(10);
    expect(parseLimitQuery(undefined, 10)).toBe(10);
  });

  it('有效值被夹在 [1, MAX_LIST_LIMIT]', () => {
    expect(parseLimitQuery('1')).toBe(1);
    expect(parseLimitQuery('0')).toBe(1);
    expect(parseLimitQuery('-5')).toBe(1);
    expect(parseLimitQuery('25.8')).toBe(25);
    expect(parseLimitQuery(String(MAX_LIST_LIMIT + 100))).toBe(MAX_LIST_LIMIT);
  });

  it('事件窗口使用独立上限', () => {
    expect(parseLimitQuery(String(MAX_AGENT_EVENT_LIMIT), 200, MAX_AGENT_EVENT_LIMIT)).toBe(MAX_AGENT_EVENT_LIMIT);
    expect(parseLimitQuery(String(MAX_AGENT_EVENT_LIMIT + 100), 200, MAX_AGENT_EVENT_LIMIT)).toBe(MAX_AGENT_EVENT_LIMIT);
  });
});

describe('validateEffectResult', () => {
  it('按 Effect 类型选择 schema', () => {
    expect(validateEffectResult('INFER', { content: 'ok' }).ok).toBe(true);
    expect(validateEffectResult('INFER', {}).ok).toBe(false);
    expect(validateEffectResult('CALL', { value: 'ok' }).ok).toBe(true);
    expect(validateEffectResult('CALL', { content: 'ok' }).ok).toBe(false);
  });
});

describe('InferEffect promptPrefixCount', () => {
  const base = { type: 'INFER', target: { providerId: 'inference', capabilityId: 'model', contractId: 'archer.inference@1', revision: 'test' }, messages: [{ role: 'system', content: 'rules' }] };

  it('显式零前缀或消息范围内的计数合法', () => {
    for (const promptPrefixCount of [0, 1]) expect(EffectSchema.safeParse({ ...base, promptPrefixCount }).success).toBe(true);
  });

  it('缺失、非整数或超出消息范围的计数明确拒绝', () => {
    expect(EffectSchema.safeParse(base).success).toBe(false);
    for (const promptPrefixCount of [-1, 1.5, 2]) {
      expect(EffectSchema.safeParse({ ...base, promptPrefixCount }).success).toBe(false);
    }
  });
});

describe('原生调用协议', () => {
  it('只接受可序列化输入，结果按 CALL 契约验证', () => {
    expect(EffectSchema.safeParse({ type: 'CALL', target: { providerId: 'test', capabilityId: 'operation', contractId: 'archer.tool@1', revision: 'test-source' }, input: { content: '记忆' } }).success).toBe(true);
    expect(EffectSchema.safeParse({ type: 'CALL', target: { providerId: 'test', capabilityId: 'operation', contractId: 'archer.tool@1', revision: 'test-source' }, input: { callback() {} } }).success).toBe(false);
    expect(validateEffectResult('CALL', { value: { saved: true } }).ok).toBe(true);
    expect(validateEffectResult('CALL', { value: undefined }).ok).toBe(false);
  });
});
