# Desktop 组件库接入

Desktop 从 `@archer/ui` 导入通用组件，共享 `design-tokens.css` 的外观、明暗、强调色与结构刻度。组件包不读取 Desktop Store、不订阅 Agent、不决定授权。

## 正式页面映射

| 正式区域 | 组件 | 数据与行为边界 |
| --- | --- | --- |
| 搜索、重命名、设置及配置编辑 | Input | 官方 Base UI 源码；原生属性、禁用、校验、回调与字号设置透传 |
| 按钮、选择器、互斥偏好、基础记录 | Button、Select、SegmentedControl、RecordDisclosure | Button 使用官方 variant / size；业务状态与动作层级由调用点显式声明 |
| 多行输入（人工回答、技能与配置编辑、新对话） | Textarea | 与 Input 共享表面、焦点环与错误状态；`plain` 变体只保留排版供组合输入容器复用 |
| 弹窗（打开工作区、重命名、删除确认、完全访问、未保存退出） | Dialog | 原生模态与 `showModal`；`size` 只有 small / medium / large 三档并只约束阅读宽度；保存中禁用关闭、遮罩关闭、触发焦点恢复与 `initialFocus` 由宿主显式声明 |
| 操作菜单、授权模式、导出 | Menu、Popover | 原生 auto popover 负责顶层、Esc 与外部点击；Menu 补齐 roving tabindex、方向键、Home / End 及关闭后焦点返回；自定义触发器通过 `PopoverTriggerProps` 转交锚点属性，图标按钮不伪装成文本按钮 |
| 会话 / 活动 / 上下文页签 | Tabs | 统一键盘选择与选中样式；三页保持挂载，滚动位置、输入草稿、活动筛选与请求选择仍由页面持有。上下文的「结构 / 原始内容」使用同一 Tabs；页签 id 与面板 id 分开生成，`aria-controls` 指向面板 |
| 上下文扫描分栏与分组 | Resizable、ScrollArea、Collapsible | 分栏只约束左右阅读区，默认左 66% / 右 34%，右栏最小 260px；两个 ScrollArea 各自承担纵向滚动，外层页面不再滚动；消息角色、工具声明与参考整理使用 Collapsible，搜索时强制展开但不改写折叠偏好 |
| 悬停说明 | Tooltip | 统一触发与定位；只补充图标按钮、指标来源与条带动作，不承载必须完成的交互 |
| 一轮对话及公开反馈 | AgentTurn、ProgressParagraph | 原序渲染，公开文本与临时预览的来源规则不变 |
| 最终回答 | AssistantAnswer | 正文通过内容插槽使用宿主的单一 Markdown 入口（Streamdown），复制与用量仍由原页处理 |
| 连续已完成工具组 | ActivityGroup、Trace | 不跨公开反馈或人工交互分组，失败、未知及当前调用保留原位 |
| 计划步骤 | Plan、Trace | `in_progress` 映射为 `running`，不推断执行成功；历史修订和当前计划入口仍由 Desktop 管理 |
| 已确认文件变更导航 | FileTree | 仅转换工具确认的历史路径，不扫描磁盘；选择进入原有 Diff 阅读器。行使用界面字号与主文本色，选中态复用导航的中性选中表面；组件不限宽，侧栏与演示页各自决定容器宽度 |

## 基础组件基准

Button、Input、Textarea、Card 复制自固定 revision 的 shadcn/ui Base UI 源码，保留官方 JSX 结构、`cn-*` 类名、variant / size、交互状态与 Base UI 原语。颜色、字号、圆角与密度通过 `packages/ui/src/theme/shadcn.css` 的 Tailwind v4 桥接读取 `design-tokens.css`，不新增主题来源；`dark:` 跟随 `data-appearance`，文字大小设置会改变 `text-xs` / `text-sm` / `text-base`。业务 `className` 由 `cn` 合并。来源、许可证与本地改动见 `packages/ui/THIRD_PARTY.md`。

布局原语同样复用官方源码：`Sidebar`（含 Provider、Inset、Header / Content / Footer，以及 Group / GroupLabel / GroupAction / Menu / MenuItem / MenuButton / MenuAction / MenuBadge / MenuSub 的完整导航体系）取自 shadcn/ui Base UI 版 `sidebar.tsx`，项目树按官方 `sidebar-11` 示例用 `Collapsible` + `SidebarMenuSub` 组合，`Resizable`（PanelGroup / Panel / Handle）取自 `resizable.tsx`，底层为 `react-resizable-panels`；`ScrollArea` 取自 `scroll-area.tsx`，由 Base UI 维护视口、滚动条与拇指状态，宿主只约束高度。桌面外壳用 `SidebarProvider` 承载折叠状态（`open` 由本机偏好 `workbench` 提供，⌘B 与移动端 Sheet 由原语处理），`SidebarInset` 作为主工作区；对话与检查器用 `ResizablePanelGroup` 分栏，宽度 320–420px，不再手写指针拖拽。Archer 只决定栏宽、折叠断点、Inspector 开关与阅读宽度，不重新实现通用分栏、折叠和浮层能力。图标占位与 Tooltip 适配见 `THIRD_PARTY.md`。

Dialog、Popover、Select、Tabs、Tooltip、Menu、Textarea 均已由包内实现取代桌面本地版本：Dialog 使用原生模态并恢复触发焦点，Popover 与 Menu 使用带锚点约束的原生 auto popover，Select 保留原生选择器与 selectedcontent 适配，Tabs、Tooltip、Textarea 与 Input 共用同一表面、焦点环与禁用状态。桌面不再保留第二套弹窗、浮层或菜单实现，也不在业务组件里重新声明按钮、输入与浮层样式；调用点只传业务状态、动作层级和布局类。

## 保留的专用能力

Markdown 的语法高亮、Mermaid、数学公式与历史 Diff 阅读器不被简化的 CodeBlock 替换：正文统一由 Streamdown 与官方插件渲染，语法高亮、公式与图表能力保持。命令授权、人类询问、结果对账仍使用现有业务流程，不能为采用 Confirmation 的简单接口而删掉权限范围或提交状态。

Sources、InlineCitation、TestResults、StackTrace 等组件仅在有可靠结构化输入的地方使用；普通工具文本不被猜测为测试、来源或错误堆栈。Suggestion 不生成未经业务定义的新动作。组件库的展示入口数不等于 Desktop 必须显示相同数量的区域。

Playground 的模拟数据、重置按钮及 PreviewFrame 不进入正式界面。主题与组件接入不改变 Agent、Runtime、Camp、Contract、授权或恢复语义。

## 未使用导出与保留决定

包内公开导出有两类在生产桌面中不直接出现：

- 仅供独立 Playground / Component Explorer 展示：ConversationViewport、FloatingSurface、DialogHeader、Card 族、直接使用的 Popover、CodeBlock、Field 族、Sources / Source、InlineCitation、Suggestions / Suggestion、StackTrace、TestResults、Task、Confirmation、Terminal。它们有公开文档与预览用例，用于验证基础能力和按结构化输入接入的边界；Task、Confirmation 等只是展示与回调组合，不新增执行能力。删除它们会同时删掉组件目录与公开文档入口，因此保留，但不得为它们新增没有真实数据来源的生产区域。
- 作为包内组合的内部结构：TraceAction 与 TraceCollapsible 三件套由 Plan、ActivityGroup 内部使用，DialogHeader / DialogActions 由 Dialog 使用，Popover 由 Menu 使用。这些零件不要求在业务页面单独出现，也不为“使用率”强行铺开。

生产页面只从包导入实际需要的导出，不把 Playground 的夹具、重置按钮或模拟数据带进正式界面；未使用不等于应当删除，接入判断以是否存在真实结构化数据与业务动作为准。

## 验证

运行组件包构建、Desktop 类型与生产构建、`tests/ai-ui`，以及 Desktop 的计划、时间线、文件变更与 Markdown 行为测试，再执行全仓 `pnpm test`、`pnpm lint`、`pnpm typecheck`、`pnpm build`。视觉验收在隔离的 Electron 实例与独立数据目录中进行，用真实模型轮次产生状态并以实际截图核对：明暗两种外观下的完整工作区、普通回答与复杂 Markdown（表格、公式、Mermaid、脚注）、无计划执行、运行中计划与已完成计划、工具失败与人工确认、长历史与多计划、设置与管理页，以及 Dialog / Menu / Popover 的键盘与焦点行为。截图来自真实运行窗口，不使用模拟夹具替代。

源码复用不等于视觉通过：旧宿主布局仍需与统一组件共同验收；类型检查、构建和单元测试不能替代实际截图比较。

计划历史事件直接使用单个 Plan，修订与解释通过 children 放入同一折叠内容，不再在旧 details 卡片中嵌套第二个 Plan。运行中的计划默认展开步骤以保持工作过程可读，已完成的计划默认收起、展开后显示真实完成数与步骤状态；用户手动选择不被普通事件更新覆盖。累计摘要使用同一紧凑 Trace 语法，不再经过 Desktop 的 conversation-activity 背景面板；事实统计与活动入口保持原有来源。

计划版本统一使用组件包 PlanHistory：外层默认折叠，展开只显示版本号与已完成步骤数；每个版本另有默认折叠的详情，标题、步骤与状态分别排版，长步骤允许折行。当前计划不被历史快照替换，也不从步骤文本猜测跨版本身份。Desktop 与 Playground 共用实现，不再直接输出裸版本列表。

## 完整轮次的单一实现

Playground 六种 Conversation Patterns 直接调用 Desktop 的 EventTimeline 与 CurrentPlan。固定展示夹具覆盖无计划、运行、完成、人工询问、局部失败和多计划，夹具不提交 Journal，不触发模型或 Provider。Patterns 不再单独拼装第二套 AgentTurn、工具、计划和终态结构。

公开反馈和最终答复通过 `ui/ai-ui/conversation/Content.tsx` 组合包组件与同一个 Streamdown 正文入口。最终答复独立示例同样复用该入口，保留语法高亮、表格、数学与图表能力。组件包不反向依赖 Desktop；此处复用的是应用内的正式组合，未来 Web 不因此复用桌面源码。

演示使用显式 `displayTime` 固定展示时钟，使运行中的示例不随系统日期产生夸大的耗时。正式页面省略此属性，继续采用既有本机时钟刷新。该属性只影响时间标签，不参与 Agent 事实、授权或恢复。
