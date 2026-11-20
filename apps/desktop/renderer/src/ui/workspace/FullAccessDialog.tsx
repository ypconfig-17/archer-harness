/** 完全访问在生效前说明范围；默认聚焦取消，不在选择菜单时提交授权。 */
import { useRef } from 'react';
import type { AuthorizationConfirmation } from '../../lib/authorization';
import { Button, Dialog, Icon } from '@archer/ui';

export function FullAccessDialog({ target, onConfirm, onClose }: {
  target: AuthorizationConfirmation | null;
  onConfirm(): void;
  onClose(): void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const title = target ? '开启完全访问？' : '将命令模式设为完全访问？';
  return (
    <Dialog
      open
      onOpenChange={() => onClose()}
      title={title}
      size="small"
      initialFocus={cancel}
      className="full-access-dialog"
      actions={<>
        <Button ref={cancel} variant="secondary" onClick={onClose}>取消</Button>
        <Button variant="default" onClick={onConfirm}>{target?.approveCurrentCommand ? '开启并执行当前命令' : '开启完全访问'}</Button>
      </>}
    >
      <div className="full-access-description">
        <p className="full-access-scope">{target ? '当前任务及此项目各对话后续发送的任务采用完全访问，直到你主动切换；不改变其他正在执行或已排队的任务。' : '此项目各对话后续发送的任务采用完全访问，直到你主动切换；不改变正在执行或已排队的任务。'}</p>
        {target?.approveCurrentCommand && <p className="full-access-current"><Icon name="check" size="sm" />同时授权执行当前正在等待确认的命令。</p>}
        <div className="full-access-notes">
          <p><Icon name="alert" size="sm" />命令使用宿主权限，可能访问工作区外文件和网络。</p>
          <p><Icon name="info" size="sm" />文件工具访问范围不变；授权不代表执行成功。</p>
        </div>
      </div>
    </Dialog>
  );
}
