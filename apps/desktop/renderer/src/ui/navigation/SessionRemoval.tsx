import { Button, Dialog } from '@archer/ui';
import { useState } from 'react';
import { useRemoveAgent } from '../../hooks/use-runtime';
import { useAgentStreamStore } from '../../store/agent-stream';
import { clearSessionDraft } from '../../store/drafts';
import { useUiStore } from '../../store/ui';

/** 所有会话入口共用确认与清理流程；执行是否可删除最终由 Runtime 判定。 */
export function useSessionRemoval(agentId: string, title: string, onRemoved?: () => void) {
  const remove = useRemoveAgent(agentId);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  async function commit() {
    setError('');
    try {
      await remove.mutateAsync();
      useAgentStreamStore.getState().clear(agentId);
      clearSessionDraft(agentId);
      const ui = useUiStore.getState();
      if (ui.view.type === 'agent' && ui.view.agentId === agentId) ui.clear();
      setConfirming(false);
      onRemoved?.();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return {
    pending: remove.isPending,
    request: () => { setError(''); setConfirming(true); },
    dialog: <Dialog
      open={confirming}
      onOpenChange={setConfirming}
      title={`删除「${title}」？`}
      description="会话将从列表移除，已提交的事件日志仍保留。工作区文件不会删除。"
      size="medium"
      closeDisabled={remove.isPending}
      actions={<>
        <Button variant="secondary" autoFocus disabled={remove.isPending} onClick={() => setConfirming(false)}>取消</Button>
        <Button variant="destructive" disabled={remove.isPending} onClick={() => void commit()}>{remove.isPending ? '正在删除…' : '删除会话'}</Button>
      </>}
    >
      {error && <p role="alert">{error}</p>}
    </Dialog>,
  };
}
