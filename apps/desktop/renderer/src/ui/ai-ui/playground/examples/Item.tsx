import { Button, Icon, Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@archer/ui';

/** 官方行结构：媒体、标题、说明与行尾操作各就各位，整行可按需渲染为按钮。 */
export default function Example({ state = 'default' }: { state?: string }) {
  const items = [
    { id: 'files', icon: 'folder' as const, title: '本地文件', description: '读取与编辑工作目录中的文件' },
    { id: 'shell', icon: 'terminal' as const, title: 'Shell 命令', description: '在宿主系统权限下执行' },
  ];
  return (
    <ItemGroup className="max-w-md">
      {items.map(item => (
        <Item key={item.id} variant={state === 'outline' ? 'outline' : 'default'}
          render={<button type="button" />} className="text-left">
          <ItemMedia variant="icon"><Icon name={item.icon} size="md" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{item.title}</ItemTitle>
            <ItemDescription>{item.description}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button variant="ghost" size="icon-xs" aria-label={`${item.title} 的操作`}><Icon name="more" size="sm" /></Button>
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  );
}
