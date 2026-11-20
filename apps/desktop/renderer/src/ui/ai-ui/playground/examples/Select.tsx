import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example({ state = 'default' }: { state?: string }) {
  const [value, setValue] = useState('local');
  return (
    <div className="example-control">
      <Select
        items={[
          { value: 'local', label: '本地目录' },
          { value: 'remote', label: '远程来源' },
        ]}
        value={value}
        disabled={state === 'disabled'}
        onValueChange={(next) => setValue(String(next))}
      >
        <SelectTrigger aria-label="示例来源">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>来源</SelectLabel>
            <SelectItem value="local">本地目录</SelectItem>
            <SelectItem value="remote">远程来源</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
