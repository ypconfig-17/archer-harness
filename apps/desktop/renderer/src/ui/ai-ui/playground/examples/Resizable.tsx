import type { CSSProperties } from 'react';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  usePanelRef,
} from '@archer/ui';

/** 分栏原语；尺寸约束用像素表达，拖拽与键盘调整由原语承担。 */
export default function Example({ state = 'default' }: { state?: string }) {
  const narrow = state === 'narrow';
  const panelRef = usePanelRef();
  return (
    <div className="example-resizable" style={{ height: 220 } as CSSProperties}>
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel minSize={160} className="example-panel">对话</ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel
          panelRef={panelRef}
          defaultSize={narrow ? 160 : 220}
          minSize={160}
          maxSize={280}
          className="example-panel"
        >
          检查器
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
