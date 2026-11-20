import { ScrollArea } from '@archer/ui';

/** 滚动区只负责视口与滚动条，高度由宿主约束。 */
export default function Example({ state = 'default' }: { state?: string }) {
  const lines = state === 'long' ? 40 : 10;
  return (
    <ScrollArea style={{ height: 180 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
        {Array.from({ length: lines }, (_, index) => (
          <p key={index} style={{ margin: 0 }}>第 {index + 1} 行滚动内容</p>
        ))}
      </div>
    </ScrollArea>
  );
}