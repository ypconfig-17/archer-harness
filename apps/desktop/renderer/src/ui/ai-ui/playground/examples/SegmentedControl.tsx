import { useState } from 'react';
import { SegmentedControl } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example() {
  const [value, setValue] = useState('standard');
  return (
    <SegmentedControl
      label="信息密度"
      value={value}
      onChange={setValue}
      options={[
        { value: 'compact', label: '紧凑' },
        { value: 'standard', label: '标准' },
      ]}
    />
  );
}
