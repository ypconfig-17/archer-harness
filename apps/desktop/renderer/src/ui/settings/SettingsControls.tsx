import { useId, type ReactNode } from 'react';
import { Button } from '@archer/ui';

/** 标签、说明与控件共同组成一个可访问的设置项，静态值也使用相同对齐方式。 */
export function SettingRow({ label, hint, children }: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="setting-row" role="group" aria-labelledby={`${id}-label`} aria-describedby={hint ? `${id}-hint` : undefined}>
      <div className="setting-row-copy">
        <span className="setting-row-label" id={`${id}-label`}>{label}</span>
        {hint && <p className="setting-row-hint" id={`${id}-hint`}>{hint}</p>}
      </div>
      <div className="setting-row-control">{children}</div>
    </div>
  );
}

export interface SettingsEditorState {
  dirty: boolean;
  busy: boolean;
}

/** 显式保存的配置共用固定操作区，反馈不随长表单滚走。 */
export function SettingsSaveBar({ dirty, busy = false, saved, error, onReset, onSave }: {
  dirty: boolean;
  busy?: boolean;
  saved?: string;
  error?: string;
  onReset(): void;
  onSave(): void;
}) {
  return (
    <footer className="settings-save-bar">
      <div className="settings-save-feedback">
        {error ? <p role="alert" className="settings-save-error">{error}</p> : (
          <p role="status">{busy ? '正在保存，请稍候…' : dirty ? '有未保存的修改' : saved || '当前配置已保存'}</p>
        )}
      </div>
      <div className="settings-save-actions">
        <Button variant="secondary" disabled={busy || !dirty} onClick={onReset}>放弃修改</Button>
        <Button variant="default" disabled={busy || !dirty} onClick={onSave}>
          {busy ? '正在保存…' : '保存修改'}
        </Button>
      </div>
    </footer>
  );
}
