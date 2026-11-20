# 第三方源码与模式来源

## shadcn/ui

- 仓库：https://github.com/shadcn-ui/ui
- 来源 revision：`e62c9435fff729a175f38983dee73b2cb4f6a069`
- 许可证：MIT，完整声明见 [licenses/shadcn-ui.txt](licenses/shadcn-ui.txt)。
- `src/ai/Trace.tsx` 改编自 `apps/v4/registry/bases/base/ui/trace.tsx`。
- `src/primitives/Collapsible.tsx` 改编自同目录 `collapsible.tsx`。
- `src/primitives/Surface.tsx` 的 Button、`src/primitives/Input.tsx`、`src/primitives/Card.tsx` 改编自同目录 `button.tsx`、`input.tsx`、`card.tsx`。
- `src/primitives/Sidebar.tsx` 改编自同目录 `sidebar.tsx`；`src/primitives/Sheet.tsx`、`Skeleton.tsx`、`Separator.tsx` 分别改编自 `sheet.tsx`、`skeleton.tsx`、`separator.tsx`；`src/lib/use-mobile.ts` 取自 `apps/v4/hooks/use-mobile.ts`。
- `src/primitives/Item.tsx` 改编自同目录 `item.tsx`；`src/primitives/Resizable.tsx` 改编自同目录 `resizable.tsx`；`src/primitives/RadioGroup.tsx`、`Label.tsx` 分别改编自 `radio-group.tsx`、`label.tsx`；`src/primitives/ScrollArea.tsx` 改编自同目录 `scroll-area.tsx`。
- `src/primitives/Select.tsx`、`src/primitives/DropdownMenu.tsx` 改编自同目录 `select.tsx`、`dropdown-menu.tsx`。
- `src/primitives/InputGroup.tsx` 改编自同目录 `input-group.tsx`。
- `src/ai/PromptInput.tsx` 改编自 AI Elements `prompt-input`（`https://registry.ai-sdk.dev/prompt-input.json`，2026-11-17 获取，AI Elements 不随 shadcn 仓库发版）。
- `src/theme/shadcn.css` 提取自 `apps/v4/registry/styles/style-rhea.css` 中已采用的 Button、Input、Card、Select、Dropdown Menu 规则；`src/primitives/layout.css` 提取同一文件的 Sidebar、Resizable、Separator、Sheet 与 Skeleton 规则。
- 保留组合结构、类名、变体、尺寸、Base UI 交互原语与无障碍属性；`cn-*` 规则与 Tailwind 类名按官方源码保留，`cn` 使用 `clsx` + `tailwind-merge`。

### 本地改动

- 颜色通过 `@theme inline` 映射到 Archer 语义 Token；`dark:` 变体改绑 `data-appearance="dark"`，不引入第二套明暗切换。
- 包内样式以 `@reference 'tailwindcss'` 引用默认主题；宿主单独编译该 CSS（如 Vite 开发态按模块处理）时 `@apply` 仍可解析，且不重复输出基础样式。
- 字号桥接 `text-xs`、`text-sm`、`text-base` 到桌面文字大小 Token；圆角与卡片内距使用 `--radius-control`、`--radius-panel` 与间距 Token。
- Button 默认 `type="button"`，避免桌面表单工具条中的按钮隐式提交。
- Input 字段底色使用 `--surface-subtle`；Button 的 secondary 悬停使用 `--surface-hover`，不引用与 Archer 同名的 `--secondary` 变量。
- 官方图标自动尺寸规则跳过 `.ui-icon`，由包内 Icon 的语义尺寸决定图标大小。
- 组件不再依赖 `ui-button`、`ui-input`、`ui-card` 旧类名；这些类的样式已从 surfaces.css 删除。
- Collapsible 的 `className` 仍按字符串传入，受控展开要求同时提供回调；其余组件的 `className` 由 `cn` 合并。
- Sidebar 系列的图标占位符替换为包内 `Icon`，不引入官方示例的图标适配层；`SidebarMenuButton` 的 `tooltip` 属性移除，折叠态提示统一使用 Archer 自有的 `Tooltip`。
- `SidebarProvider` 的 `open` / `onOpenChange` 由宿主持久化偏好控制，组件内仍保留官方的 cookie 写入与 ⌘B 快捷键；`--sidebar-width`、`--sidebar-width-icon` 由宿主按 Archer 刻度覆盖。
- 新增 `--color-sidebar-*` 主题令牌映射，指向既有中性层与强调色，不新增第二套侧栏配色。
- Select / DropdownMenu 的图标占位符替换为包内 `Icon`；触发器沿用字段底色、控件圆角与 Archer 焦点环，浮层去掉官方的半透明毛玻璃底，改用不透明浮层表面与 `--shadow-popover`。
- Select 与 DropdownMenu 的条目高亮同时覆盖 `focus` 与 `data-highlighted`，避免鼠标悬停时无反馈。
- 原有原生 select 封装置名为 `NativeSelect`，只保留给仍依赖 base-select 原生展开行为的密集表单；对外的 `Select` 名称与 shadcn 官方一致，指向 Base UI 选择器。
- Prompt Input 去掉对 `ai`（FileUIPart/ChatStatus）与 `nanoid` 的依赖，改用本地 `PromptInputFile` 类型与 `crypto.randomUUID`；去掉 `PromptInputProvider`、Command / Tabs / 语音输入子组件，只保留输入、附件、动作菜单与提交态。
- 图片附件使用 Base UI PreviewCard 提供悬停预览，使用包内 Dialog 提供点击大图、Esc / 遮罩关闭与焦点归还；附件移除按钮独立于预览触发器。
- Prompt Input 的动作菜单改用包内 Base UI DropdownMenu（`render` 代替 `asChild`），图标统一为包内 `Icon`；附件条目使用 `ui-prompt-attachment*` 规则，与输入区共用控件刻度。

Tool、Reasoning、Plan、FileTree、Sidebar 与 Field 参考官方文档的组合方式，在本地实现 Archer 所需接口，并非复制整套 AI SDK 示例。CodeBlock 的官方源码来源与调整见下方独立说明。

Sources、InlineCitation、Suggestion、StackTrace 与 TestResults 依据 AI Elements 的模式语义在本地实现，包含 Archer 自己的协议限制、空态和只读边界；未复制上游源码，因此不进入上述改编清单。Prompt Input 是上游源码改编，已列入上方清单。

## 运行依赖

`@base-ui/react` 是必要的可访问交互原语依赖，只使用所需子路径。它不参与 Agent 生命周期、授权或消息状态管理，许可证由依赖自身提供。不安装 AI SDK、assistant-ui 或独立 AI Runtime。

`react-resizable-panels` 是官方 Resizable 的底层实现，只承担分栏拖拽与尺寸约束，不参与业务状态。

公共 Resizable 额外导出底层 `usePanelRef`，供导航折叠和展开时调整面板尺寸；指针及键盘拖拽仍使用原组件实现。

## shadcn/ui Code Block

`src/renderers/CodeBlock.tsx`、`use-highlighted-code.ts` 与 `highlighter.tsx` 复制自 shadcn/ui Base Nova 官方 registry（MIT）：
https://ui.shadcn.com/r/styles/base-nova/code-block.json
https://ui.shadcn.com/r/styles/base-nova/use-highlighted-code.json

保留官方组合 API、结构、复制状态及增量高亮逻辑；调整本地导入、Phosphor 图标、中文文案与主题 Token，补充 Java 语法加载。CodeSnippet 仅组合这些原语用于带文件名的业务内容，不提供另一套外壳实现。

## Base UI 公共交互底座

Tabs、Switch、SegmentedControl、Dialog、Popover 直接组合 `@base-ui/react` 原语，
不再维护独立的键盘导航、开关事件、弹窗焦点或浮层定位算法。
这些组件是 Archer 的组合封装，不宣称为 shadcn 官方源码复制。
SegmentedControl 忽略清空选择请求；Dialog 的提交中禁止关闭和默认不点击遮罩关闭由宿主约束。
Popover 统一 Portal 到 body，通过 Positioner 处理边界避碰。

Checkbox 直接组合 Base UI Checkbox Root / Indicator，图标和语义 Token 沿用 Archer。
Sources、StackTrace、TestResults 的展开交互复用公共 Collapsible；数据投影与 URL 限制仍由原有本地组件负责。

InteractionRecord、RecordDisclosure 与活动历史的展开交互统一组合公共 Collapsible；
TraceAction 与附件移除改用公共 Button，保留 Trace 和 Prompt Input 的来源及宿主动作边界。
ConversationViewport 的滚动条组合公共 ScrollArea，阅读跟随仍是本地展示逻辑。
InlineCitation 的悬停说明使用公共 Tooltip，不引入远程来源读取。

## T3 Code 审阅阅读器

`src/renderers/diff-theme.ts` 的并排换行网格约束改编自 T3 Code 的
`apps/web/src/components/diffs/StyledDiffCodeView.tsx`（2026-11-19 读取 main）：
https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/diffs/StyledDiffCodeView.tsx

许可证为 MIT，完整声明见 [licenses/t3-code.txt](licenses/t3-code.txt)。
仅采用列宽稳定设计；排版使用 Archer Token，不复制应用状态、路由或主题配色。
