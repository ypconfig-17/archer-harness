import { useState } from 'react';
import { RecordDisclosure, RecordRow, Icon } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example() {
  const [value, setValue] = useState('未选择');
  return (
    <>
      <RecordDisclosure summary="历史记录">
        <p>完整记录保留在折叠内容中。</p>
      </RecordDisclosure>
      <RecordRow onClick={() => setValue('已选择记录')}>
        <Icon name="file" size="sm" />
        打开记录
      </RecordRow>
      <p role="status">{value}</p>
    </>
  );
}
