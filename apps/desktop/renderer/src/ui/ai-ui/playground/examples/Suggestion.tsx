import { useState } from 'react';
import { Suggestion, Suggestions } from '@archer/ui';

/** 建议点击只更新本页状态，不发送消息或提交任务。 */
export default function Example({ state = 'default' }: { state?: string }) {
  const [selected, setSelected] = useState<string>();
  return (
    <>
      <Suggestions label="快捷建议">
        <Suggestion
          disabled={state === 'disabled'}
          onClick={() => setSelected('总结当前变更')}
        >
          总结当前变更
        </Suggestion>
        <Suggestion
          disabled={state === 'disabled'}
          onClick={() => setSelected('解释这次失败')}
        >
          解释这次失败
        </Suggestion>
        <Suggestion
          disabled={state === 'disabled'}
          onClick={() => setSelected('检查未提交记录')}
        >
          检查未提交记录
        </Suggestion>
      </Suggestions>
      <p role="status">{selected ? `已选择：${selected}` : '等待选择'}</p>
    </>
  );
}
