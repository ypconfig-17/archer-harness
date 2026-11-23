import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PatternPreview } from '../../../apps/desktop/renderer/src/ui/ai-ui/playground/Patterns';
import { patternEvents, type PatternScene } from '../../../apps/desktop/renderer/src/ui/ai-ui/playground/pattern-events';
import { EventTimeline } from '../../../apps/desktop/renderer/src/ui/workspace/EventTimeline';

it('六种完整场景使用正式时间线与正文阅读器，场景边界保持不同', () => {
  const scenes: PatternScene[] = ['no-plan', 'running', 'completed', 'confirmation', 'failed', 'history'];
  for (const scene of scenes) {
    const html = renderToStaticMarkup(createElement(PatternPreview, { scene }));
    expect(html).toContain('class="transcript"');
    expect(html).toContain('与 Desktop 共用 EventTimeline');
    expect(html).not.toContain('演示不发送</button>');
    if (scene === 'no-plan') expect(html).not.toContain('aria-label="计划事件"');
    if (scene === 'confirmation') expect(html).toContain('需要你的确认');
    if (scene === 'failed') expect(html).toContain('报告写入失败');
    if (scene === 'completed') {
      expect(html).toContain('aria-label="最终答复"');
      expect(html).toContain('<table');
      expect(html).toContain('消息与活动顺序');
    }
  }
});

it('回答后保留原位置记录并继续公开反馈，不留下等待卡片', () => {
  const html = renderToStaticMarkup(createElement(EventTimeline, {
    events: patternEvents('confirmation', true), compact: true, active: true,
    displayTime: Date.UTC(2026, 0, 1, 10, 24, 4),
  }));
  expect(html).toContain('已回答');
  expect(html).toContain('按你的选择，继续核对已加载内容');
  expect(html.indexOf('已回答')).toBeLessThan(html.indexOf('按你的选择'));
  expect(html).not.toContain('需要你的确认');
});
