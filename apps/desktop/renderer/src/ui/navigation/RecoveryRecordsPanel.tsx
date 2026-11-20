import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { client } from '../../lib/api';
import { Button, Dialog } from '@archer/ui';

/** 仅管理宿主确认的异常日志，不从损坏内容推断状态或重试外部操作。 */
export function RecoveryRecordsPanel({ onClose }: { onClose(): void }) {
  const records = useQuery({ queryKey: ['recovery-records'], queryFn: () => client.recoveryRecords() });
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmIds, setConfirmIds] = useState<string[]>([]);

  async function isolate() {
    setBusy(true);
    setError('');
    try {
      // 逐条处理，部分成功也要刷新明细；失败的原始记录继续保留处理入口。
      for (const id of confirmIds) await client.isolateRecoveryRecord(id);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['recovery-records'] }),
        queryClient.invalidateQueries({ queryKey: ['health'] }),
      ]);
      setConfirmIds([]);
      setBusy(false);
    }
  }

  async function exportRecord(id: string) {
    setBusy(true);
    setError('');
    try {
      const { contentBase64 } = await client.exportRecoveryRecord(id);
      // 损坏日志也可能含无效 UTF-8；按原始字节导出，避免文本解码改变证据。
      const bytes = Uint8Array.from(atob(contentBase64), character => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${id}.jsonl`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <Dialog
    open
    onOpenChange={() => { if (!busy) onClose(); }}
    title="异常历史记录"
    size="large"
    closeDisabled={busy}
    className="recovery-records-dialog"
    actions={<>
      <Button variant="secondary" disabled={busy || !records.data?.length} onClick={() => setConfirmIds(records.data!.map(record => record.agentId))}>全部移出加载范围</Button>
      <Button variant="secondary" disabled={busy} onClick={onClose}>关闭</Button>
    </>}
  >
    <p>这些日志未通过恢复校验，无法可靠读取会话标题与执行状态。移出加载范围后，原始文件完整保留在服务端的 isolated-agents 目录，后续启动不会再加载；此操作不会重试或撤销外部操作。</p>
    {error && <p role="alert">{error}</p>}
    {records.isError && <p role="alert">{records.error.message}<Button variant="link" onClick={() => void records.refetch()}>重试</Button></p>}
    {records.isPending && <p>正在读取…</p>}
    {records.data?.length === 0 && <p>没有待处理的异常记录。</p>}
    <div className="management-list">
      {records.data?.map(record => <div className="recovery-record" key={record.agentId}>
        <strong>{record.agentId}</strong>
        <p>{record.reason}</p>
        <div className="management-actions">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void exportRecord(record.agentId)}>导出原始记录</Button>
          <Button variant="destructive" size="sm" disabled={busy} onClick={() => setConfirmIds([record.agentId])}>移出加载范围</Button>
        </div>
      </div>)}
    </div>
    {confirmIds.length > 0 && <div className="management-confirm" role="alert">
      <span>将 {confirmIds.length} 条异常记录移出加载范围？原始日志会保留，处理未知执行结果仍需人工核查。</span>
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirmIds([])}>取消</Button>
      <Button variant="destructive-solid" size="sm" disabled={busy} onClick={() => void isolate()}>{busy ? '正在处理…' : '确认移出'}</Button>
    </div>}
  </Dialog>;
}
