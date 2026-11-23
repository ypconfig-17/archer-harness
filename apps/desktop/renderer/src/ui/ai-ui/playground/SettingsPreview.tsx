import { useState } from 'react';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
  Input,
  NativeSelect,
  SegmentedControl,
  Button,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@archer/ui';

/** 仅验证设置组件的组合和作用域提示，不写入正式设置或请求服务。 */
export function SettingsPreview() {
  const [section, setSection] = useState('appearance');
  const [size, setSize] = useState('standard');
  const [url, setUrl] = useState('');
  const invalid = url.length > 0 && !/^https?:\/\//.test(url);
  return (
    <section aria-label="设置组件演示">
      <h2>侧栏与设置表单</h2>
      <p>示例只影响本页；主题选择读取全局 Token，不保存正式应用偏好。</p>
      <SidebarProvider className="demo-settings-provider">
      <div className="demo-settings-workspace">
        <Sidebar collapsible="none" aria-label="演示设置导航" className="demo-settings-sidebar">
          <SidebarHeader><strong>设置</strong></SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>使用偏好</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive={section === 'appearance'} onClick={() => setSection('appearance')}>
                      外观与主题
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive={section === 'models'} onClick={() => setSection('models')}>
                      模型连接
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <div>
          {section === 'appearance' ? (
            <FieldGroup title="外观与主题">
              <Field>
                <FieldLabel htmlFor="demo-appearance">外观模式</FieldLabel>
                <NativeSelect
                  id="demo-appearance"
                  defaultValue={document.documentElement.dataset.appearance ?? 'light'}
                  onChange={(event) => {
                    document.documentElement.dataset.appearance = event.target.value;
                  }}
                >
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="demo-base">界面主题</FieldLabel>
                <NativeSelect
                  id="demo-base"
                  defaultValue={document.documentElement.dataset.baseTheme ?? 'graphite'}
                  onChange={(event) => {
                    document.documentElement.dataset.baseTheme = event.target.value;
                  }}
                >
                  <option value="graphite">Graphite</option>
                  <option value="midnight">Midnight</option>
                  <option value="slate">Slate</option>
                  <option value="warm">Warm</option>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="demo-accent">强调色</FieldLabel>
                <NativeSelect
                  id="demo-accent"
                  defaultValue={document.documentElement.dataset.theme ?? 'graphite-iris'}
                  onChange={(event) => {
                    document.documentElement.dataset.theme = event.target.value;
                  }}
                >
                  <option value="graphite-iris">Graphite Iris</option>
                  <option value="slate-teal">Slate Teal</option>
                  <option value="carbon-amber">Carbon Amber</option>
                  <option value="dusty-rose">Dusty Rose</option>
                </NativeSelect>
              </Field>
              <Field>
                <span className="ui-setting-label">字号选择交互</span>
                <SegmentedControl
                  label="示例字号选择"
                  value={size}
                  onChange={setSize}
                  options={[
                    { value: 'compact', label: '紧凑' },
                    { value: 'standard', label: '标准' },
                  ]}
                />
                <FieldDescription>只验收单选交互，不改变全局字号。</FieldDescription>
              </Field>
            </FieldGroup>
          ) : (
            <FieldGroup title="模型连接示例">
              <Field>
                <FieldLabel htmlFor="demo-url">服务地址</FieldLabel>
                <Input
                  id="demo-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  aria-invalid={invalid}
                  aria-describedby={invalid ? 'demo-url-help demo-url-error' : 'demo-url-help'}
                  placeholder="https://example.com"
                />
                <FieldDescription id="demo-url-help">
                  不连接服务，只验收输入与错误状态。
                </FieldDescription>
                {invalid && (
                  <FieldError id="demo-url-error">地址需要以 http:// 或 https:// 开头。</FieldError>
                )}
              </Field>
              <Button variant="secondary" disabled>演示不保存配置</Button>
            </FieldGroup>
          )}
        </div>
      </div>
      </SidebarProvider>
    </section>
  );
}
