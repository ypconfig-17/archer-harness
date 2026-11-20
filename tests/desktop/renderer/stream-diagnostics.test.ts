/** 诊断默认关闭，只输出长度和时序，观察故障不能影响正文更新。 */
import { afterEach, expect, it, vi } from 'vitest';
import { traceStream } from '../../../apps/desktop/renderer/src/lib/stream-diagnostics';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('默认不输出，开启后记录相邻增量与 DOM 长度', () => {
  let enabled = false;
  vi.stubGlobal('localStorage', { getItem: () => enabled ? '1' : null });
  const output = vi.spyOn(console, 'info').mockImplementation(() => {});
  traceStream('Renderer', 'diagnostic-test', 3, 'generating');
  expect(output).not.toHaveBeenCalled();
  enabled = true;
  vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1020);
  traceStream('UI Commit', 'diagnostic-test', 3, 'generating', 3);
  traceStream('UI Commit', 'diagnostic-test', 8, 'generating', 7);
  expect(JSON.parse(output.mock.calls[1]![0])).toMatchObject({
    effectId: 'diagnostic-test', content: 8, deltaChars: 5, intervalMs: 20, renderedChars: 7,
  });
});

it('无法访问存储时不打断调用方', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('unavailable'); } });
  expect(() => traceStream('Renderer', 'unavailable', 1, 'generating')).not.toThrow();
});
