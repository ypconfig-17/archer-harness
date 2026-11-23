/** 模型等级选择按实际支持范围处理，独立保存并固定到提交参数。 */
import { expect, it } from 'vitest';
import type { ModelSettings, ReasoningLevel } from '@archer/contracts';
import { modelKey, selectedInference, selectedModel, selectedReasoning, REASONING_LABELS } from '../../../apps/desktop/renderer/src/lib/model-selection';
const models: ModelSettings = { revision: 'one', mode: 'pi', config: {}, protocols: [], defaultModel: { provider: 'deepseek', id: 'flash' }, models: [
  { provider: 'deepseek', id: 'flash', name: 'Flash', reasoningLevels: ['off', 'low', 'high', 'max'], defaultReasoning: 'high' },
  { provider: 'other', id: 'reasoner', name: 'Reasoner', reasoningLevels: ['low', 'medium', 'high'], defaultReasoning: 'medium' },
  { provider: 'other', id: 'plain', name: 'Plain', reasoningLevels: ['off'], defaultReasoning: 'off' },
] };
it('默认模型也能选择等级，不同模型各自保留选择', () => {
  const flash = models.models[0]!, reasoner = models.models[1]!;
  const preferences: Record<string, ReasoningLevel> = { [modelKey(flash)]: 'max', [modelKey(reasoner)]: 'low' };
  expect(selectedModel('', models)).toEqual(flash);
  expect(selectedInference('', models, preferences)).toEqual({ provider: 'deepseek', model: 'flash', reasoning: 'max' });
  expect(selectedInference(modelKey(reasoner), models, preferences)).toEqual({ provider: 'other', model: 'reasoner', reasoning: 'low' });
});
it('旧选择超出新模型能力时回到该模型默认值，不能发送不支持的等级', () => {
  const flash = models.models[0]!, plain = models.models[2]!;
  expect(selectedReasoning(flash, { [modelKey(flash)]: 'medium' })).toBe('high');
  expect(selectedInference(modelKey(plain), models, { [modelKey(plain)]: 'high' })?.reasoning).toBe('off');
  expect(selectedInference('missing', models)).toEqual({ provider: 'deepseek', model: 'flash', reasoning: 'high' });
  expect(selectedInference('', { ...models, defaultModel: undefined })).toBeUndefined();
  expect(selectedInference('', { ...models, mode: 'mock' })).toBeUndefined();
});
it('已生成请求不随偏好后续调整变化，界面等级全部使用中文', () => {
  const flash = models.models[0]!; const preferences: Record<string, ReasoningLevel> = { [modelKey(flash)]: 'low' };
  const submitted = selectedInference(modelKey(flash), models, preferences);
  preferences[modelKey(flash)] = 'max'; expect(submitted?.reasoning).toBe('low');
  expect(Object.values(REASONING_LABELS).every(label => /[\u4e00-\u9fff]/u.test(label))).toBe(true);
});
