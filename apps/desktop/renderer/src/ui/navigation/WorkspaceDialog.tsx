/**
 * 工作区添加流程：通过桌面壳打开系统目录选择器，选定后保存工作目录，创建 Agent 时绑定执行环境。
 */

import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Icon, Spinner } from '@archer/ui';

type Phase = 'picking' | 'failed' | 'unsupported';

export function WorkspaceDialog({
  onClose,
  onAdded,
}: {
  onClose(): void;
  onAdded(root: string): void;
}) {
  const started = useRef(false);
  const alive = useRef(true);
  const [phase, setPhase] = useState<Phase>('picking');
  const [error, setError] = useState('');
  const dismissable = phase === 'failed' || phase === 'unsupported';

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void pick();
  }, []);

  async function pick() {
    const bridge = window.archerDesktop;
    if (!bridge?.chooseDirectory) {
      setPhase('unsupported');
      return;
    }
    setPhase('picking');
    setError('');
    try {
      const selected = await bridge.chooseDirectory();
      if (!alive.current) return;
      if (selected === null) {
        onClose();
        return;
      }
      onAdded(selected);
    } catch (cause) {
      if (!alive.current) return;
      setPhase('failed');
      setError((cause as Error).message);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={() => { if (dismissable) onClose(); }}
      title="打开工作区"
      size="small"
      closeDisabled={!dismissable}
      dismissOnBackdrop={dismissable}
      className="workspace-dialog"
    >
      <div className="workspace-dialog-body">
        {phase === 'picking' && (
          <div className="workspace-dialog-state" role="status">
            <Spinner label="正在等待文件夹选择" />
            <p>正在等待文件夹选择…</p>
            <span>请在系统窗口中选择本机目录；取消则返回。</span>
          </div>
        )}
        {phase === 'failed' && (
          <div className="workspace-dialog-note" role="alert">{error}</div>
        )}
        {phase === 'unsupported' && (
          <div className="workspace-dialog-state">
            <Icon name="alert" size="md" />
            <p>当前环境无法打开系统文件夹选择。</p>
            <span>请通过 Archer 桌面应用打开本机工作区。</span>
          </div>
        )}
      </div>
      <footer className="workspace-dialog-foot">
        {phase === 'picking' && <span className="workspace-dialog-hint">选定目录后将作为工作区打开。</span>}
        <div className="workspace-dialog-actions">
          {phase === 'unsupported' && (
            <Button variant="default" onClick={onClose}>关闭</Button>
          )}
          {phase === 'failed' && (
            <>
              <Button variant="secondary" onClick={() => void pick()}>重新选择</Button>
              <Button variant="secondary" onClick={onClose}>取消</Button>
            </>
          )}
        </div>
      </footer>
    </Dialog>
  );
}
