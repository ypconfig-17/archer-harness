import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { Button, ConfirmDialog, DialogActions, FormField } from '@archer/ui';

it('普通动作放进表单也不会隐式提交，显式提交动作保留表单语义', () => {
  const plain = renderToStaticMarkup(createElement('form', {}, createElement(Button, {}, '取消')));
  const submit = renderToStaticMarkup(createElement(Button, { type: 'submit' }, '保存'));
  expect(plain).toContain('type="button"');
  expect(submit).toContain('type="submit"');
});

it('危险确认提供可访问的标题和说明，呈现时不执行删除动作', () => {
  const onConfirm = vi.fn();
  const markup = renderToStaticMarkup(createElement(ConfirmDialog, {
    title: '删除配置？',
    description: '会话记录保持不变。',
    confirmLabel: '删除配置',
    onConfirm,
    onClose: vi.fn(),
  }));
  const titleId = markup.match(/aria-labelledby="([^"]+)"/)?.[1];
  const descriptionId = markup.match(/aria-describedby="([^"]+)"/)?.[1];
  expect(titleId).toBeTruthy();
  expect(descriptionId).toBeTruthy();
  expect(markup).toContain(`id="${titleId}"`);
  expect(markup).toContain(`id="${descriptionId}"`);
  expect(markup).toContain('取消');
  expect(markup).not.toContain('type="submit"');
  expect(onConfirm).not.toHaveBeenCalled();
});

it('弹窗字段具有可见标签，底部普通动作不隐式提交表单', () => {
  const html = renderToStaticMarkup(createElement('form', {},
    createElement(FormField, { label: '会话标题', children: createElement('input', { name: 'title' }) }),
    createElement(DialogActions, { children: [
      createElement(Button, { key: 'cancel' }, '取消'),
      createElement(Button, { key: 'save', type: 'submit', variant: 'default' }, '保存'),
    ] }),
  ));
  expect(html).toContain('<label class="ui-field"><span>会话标题</span><input');
  expect(html).toContain('class="ui-dialog-actions"');
  expect(html.match(/type="submit"/g)).toHaveLength(1);
});
