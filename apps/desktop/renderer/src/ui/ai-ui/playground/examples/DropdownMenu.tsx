import { useState } from 'react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
} from '@archer/ui';

/** 菜单只回调本地状态，不执行真实命令。 */
export default function Example() {
  const [mode, setMode] = useState('ask');
  return (
    <div className="example-control">
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="secondary" />}>
          命令授权
          <Icon name="chevron-down" size="xs" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="example-menu">
          <DropdownMenuLabel>运行方式</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={mode} onValueChange={(next) => setMode(String(next))}>
            <DropdownMenuRadioItem value="ask">每次询问</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="auto">自动审批</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="full">完全访问</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
