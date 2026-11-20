import { useEffect, useRef, type ReactNode } from 'react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle, usePanelRef, useSidebar } from '@archer/ui';
import { useWorkbench } from '../../store/workbench';

/** 左右导航统一交给公共分栏组件，移动端仍由 Sidebar 自己管理抽屉。 */
export function NavigationPanels({ navigation, children }: { navigation: ReactNode; children: ReactNode }) {
  const { state, isMobile } = useSidebar();
  const width = useWorkbench(value => value.sidebarWidth);
  const saveWidth = useWorkbench(value => value.setSidebarWidth);
  const panel = usePanelRef();
  const pending = useRef(width);
  const collapsed = state === 'collapsed';
  const compactWidth = isMobile ? 0 : 56;
  useEffect(() => {
    // 展开恢复用户宽度，不把折叠图标轨或移动端零宽度保存成偏好。
    panel.current?.resize(isMobile || collapsed ? compactWidth : width);
  }, [collapsed, isMobile, compactWidth, width, panel]);
  return <ResizablePanelGroup orientation="horizontal" className="navigation-panels"
    onLayoutChanged={(_layout, meta) => {
      if (meta.isUserInteraction && !isMobile && !collapsed && pending.current !== width) saveWidth(pending.current);
    }}
  >
    <ResizablePanel panelRef={panel} id="navigation" className="navigation-panel"
      defaultSize={isMobile || collapsed ? compactWidth : width}
      minSize={isMobile || collapsed ? compactWidth : 260}
      maxSize={isMobile || collapsed ? compactWidth : 420}
      onResize={size => { pending.current = Math.round(size.inPixels); }}
    >{navigation}</ResizablePanel>
    {!isMobile && !collapsed && <ResizableHandle aria-label="调整侧栏宽度" />}
    <ResizablePanel id="application" minSize={isMobile ? 0 : 360} className="application-panel">
      {children}
    </ResizablePanel>
  </ResizablePanelGroup>;
}
