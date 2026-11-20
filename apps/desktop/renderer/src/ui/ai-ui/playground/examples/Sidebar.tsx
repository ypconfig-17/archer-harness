import type { CSSProperties } from 'react';
import {
  Icon,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@archer/ui';

/** 官方 Sidebar 的组合结构；折叠态由 Provider 的 open 控制。 */
export default function Example({ state = 'default' }: { state?: string }) {
  const collapsed = state === 'collapsed';
  return (
    <div className="example-sidebar">
      <SidebarProvider
        open={!collapsed}
        className="example-sidebar-provider"
        style={{ '--sidebar-width': '200px', '--sidebar-width-icon': '56px' } as CSSProperties}
      >
        <Sidebar collapsible="icon" aria-label="示例导航">
          <SidebarHeader>
            <strong>Archer</strong>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>工作区</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive>
                      <Icon name="compose" size="sm" />
                      对话
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton>
                      <Icon name="settings" size="sm" />
                      设置
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <p>本地演示</p>
          </SidebarFooter>
        </Sidebar>
      </SidebarProvider>
    </div>
  );
}
