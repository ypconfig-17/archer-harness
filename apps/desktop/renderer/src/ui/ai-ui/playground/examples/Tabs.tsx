import { useState } from 'react';
import { Tabs } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example() {
  const [view, setView] = useState<'conversation' | 'activity' | 'context'>('conversation');
  return (
    <div className="example-stack">
      <Tabs
        label="示例工作区"
        value={view}
        items={[
          { value: 'conversation', label: '对话' },
          { value: 'activity', label: '活动' },
          { value: 'context', label: '上下文' },
        ]}
        onChange={setView}
      />
      <p role="status">当前视图：{view}</p>
    </div>
  );
}
