# Archer UI Component Explorer

## 入口与职责

本地入口为 `http://127.0.0.1:5173/agent-ui.html`，沿用 Desktop 的 Vite 服务，不新增应用、服务端或第二份组件实现。先构建 `@archer/ui`，再启动桌面开发服务。正式对话、设置及事件适配不因文档站而替换。

目录分为 Primitives、AI、Renderers、Patterns。组件从 `@archer/ui` 实际导入，目录和状态只属于文档页，不是消息协议、事件 Registry 或 UI Runtime。

## 页面与导航

组件使用 `#/分类/组件名` 的稳定地址，例如 `#/ai/plan`、`#/ai/confirmation`、`#/renderers/codeblock`。空地址默认进入全部组件总览（`#/overview`）。未知地址显示找不到页面；组件搜索只筛选目录，不强制改变正在阅读的页面。左侧目录和右侧阅读区分别滚动。

所有公开的运行时组件都有独立入口。CardHeader、TraceTitle 等辅助组件在所属完整组合中演示，并显示组合用法，不制造没有上下文的空容器。类型接口不是可渲染组件，不建立空展示页。

组件目录定义在 `apps/desktop/renderer/src/ui/ai-ui/playground/catalog.ts`。每项明确所属分类、说明、状态、Props 说明、真实示例模块及源码。新增公开组件必须同时登记独立页面和可运行示例；自动测试比较 `packages/ui/src/index.ts` 的运行时导出与目录，避免遗漏。

## Preview、Code、Usage、Source

- Preview：直接运行 `examples/*.tsx` 中导出的实际组件组合，包含适用状态与交互。切换状态重新初始化示例；同一状态内的手动展开、输入和选择由实际组件管理。
- Code：Vite 将同一份示例以 `?raw` 读取，展示完整可复制 TSX，支持行号、折行和复制。不是另外手写一份看似相同的示例字符串，也不是完整组件实现源码的替代。组件实现仍在 `packages/ui/src`。
- Usage：列出主要 Props、状态、组合方式、交互说明与业务边界。原生 HTML 属性不逐项复制 React 类型定义；子部件文档说明其所在组合，完整签名以组件类型为准。
- Source：读取 `packages/ui/src` 中实际维护的实现文件。多个导出共用文件时展示完整文件；组合场景展示实际场景代码，不以示例冒充实现。

页签使用 tablist / tab / tabpanel 语义，方向键、Home、End 切换并移动焦点。未选面板隐藏但保留挂载，来回阅读 Code / Usage / Source 不清空 Preview 操作。页面切换重新初始化局部示例。

## 核心组件与行为

Message 组织用户或 Agent 的公开消息、头部与动作。它不读取推理或生成内容。Task 展示已收到的动态活动步骤，不要求存在 Plan，也不推断任务完成。Plan 仍表示模型声明。

Confirmation 的 pending 状态显示问题、范围和允许 / 拒绝动作；busy 禁止重复点击；decision 由宿主确认后显示折叠记录。组件仅回调，不自行调用 Runtime 授权端口，不将“已允许”标为任务成功。示例将回调写入本地状态，不执行命令。

Terminal 显示传入命令、输出和 pending / running / completed / error / unknown 状态。运行中默认展开，用户手动选择优先；暂无输出明确说明，不因空输出或停止流式而推断成功或失败。“追加输出”只追加固定演示文本。

Reasoning 示例只使用明确标注的可展示固定文本，不加载真实内部推理。文件树选择不读取磁盘。设置示例不写入正式偏好。所有示例禁止引入真实外部副作用。

## 只读内容组件

Sources、InlineCitation、Suggestion、StackTrace 与 TestResults 只接收宿主已经确认的展示数据，不新增执行、授权或恢复能力：

- Sources / Source 展示来源序号、标题、说明与原文地址；组件不抓取链接，也不判断来源是否可信。空列表不渲染空壳。
- InlineCitation 展示行内来源编号。只有 http / https 会渲染为可点击入口；其他协议保留编号与标题文字，避免把未知协议变成导航。
- Suggestion / Suggestions 只回调宿主选择，不自动提交消息、不推断用户意图；禁用条件由宿主显式传入。
- StackTrace 只读取结构化帧，不解析原始堆栈字符串，也不根据调用顺序补造函数名、行号或列号。
- TestResults 只统计传入用例，不执行测试、不重算套件结论；失败详情与分组均来自宿主字段。
- HistoricalDiff 只接收宿主提供的 before / after 原文，按原始行号标出增删；默认保留修改前后各 3 行、首次最多 160 行，可展开完整内容。组件不读取磁盘、不调用 Git，也不判断片段是否连续，缺失原文不推断。

这些组件与正式事件、授权和工具执行没有连接。示例中的链接、堆栈和测试结果都是固定展示数据，不访问网络或本地文件。

## 运行态与动效

运行中的 Task、Tool、Plan、Reasoning、Terminal 与 TurnSummary 显示旋转指示，运行标题带有克制的扫光提示，完成或错误状态停止；动画只表示“正在运行”，不推断进度、成功或执行事实。折叠内容使用高度与透明度过渡，按钮、分段选择、对话框与浮层使用短过渡。开启 prefers-reduced-motion 时移除旋转、位移和过渡，保留静态指示与状态文字。组件页的 Preview 会在状态切换时重置动画，Code / Usage / Source 不挂载执行示例。

## Patterns

Patterns 保留无计划执行、运行中、已完成、人工交互、工具失败、长历史 / 多计划六类会话场景，以及文件检查器、设置工作区两类应用组合。它们用于检查组件之间的密度、对齐和连续阅读，不代替独立组件页面。

复杂场景源码在 `Patterns.tsx`、`FilePreview.tsx`、`SettingsPreview.tsx`，展示站读取原文件作为 Code。组合场景同样复用包组件，保留当前 Vite 入口，不新增正式业务路由。

## 官方模式覆盖

`#/coverage` 对照 [shadcn/ui AI Elements](https://ui.shadcn.com/docs/ai-elements) 的 21 个 AI 模式，数据位于 `coverage.ts`。

| 模式 | 组件库覆盖 | 边界 |
| --- | --- | --- |
| Chain of Thought | 部分实现 | Trace / ActivityGroup 可组合，无独立摘要生成 |
| Chat | 部分实现 | Message、AgentTurn、Viewport 与 Patterns 可组合，无独立完整 Chat API |
| Checkpoint | 未实现 | 无历史恢复点操作，不冒充现有恢复机制 |
| Confirmation | 已实现 | 受控交互与结果历史；不自动接真实审批 |
| Context | 部分实现 | 正式页已有业务阅读，尚未抽为独立组件 |
| File Tree | 已实现 | 节点展示和路径回调 |
| Inline Citation | 已实现 | 行内编号；仅 http / https 生成入口，其他协议只保留文字 |
| Message | 已实现 | 公开消息与插槽 |
| Model Selector | 部分实现 | 基础选择可用，模型业务尚在 Desktop |
| Plan | 已实现 | 计划声明和进度 |
| Prompt Input | 已实现 | 官方 Prompt Input：文本、附件选择、拖拽/粘贴与提交态 |
| Queue | 部分实现 | 正式页有队列，包内未抽独立 Queue |
| Reasoning | 已实现 | 允许展示的文本和开关 |
| Sources | 已实现 | 宿主确认的来源列表；不抓取、不推断可信度，空列表不渲染空壳 |
| Stack Trace | 已实现 | 结构化帧展示；不解析原始堆栈、不补造缺失位置 |
| Subagent | 未实现 | 不提供当前运行机制不支持的操作 |
| Suggestion | 已实现 | 只回调宿主，不自动提交消息或推断意图 |
| Task | 已实现 | 动态步骤与局部状态 |
| Terminal | 已实现 | 命令与输出阅读，不执行命令 |
| Test Results | 已实现 | 结构化用例与汇总；不执行测试，数量只统计传入用例 |
| Tool | 已实现 | 调用、详情与局部状态 |

Questionnaire 作为额外对照：当前可通过 InteractionCard 提供问题和动作，但没有通用题型及校验系统。Trace 与 CodeBlock 属于共享基础，各有独立页面。已实现只表示组件展示及本地回调；正式事件接入、主题组合与 Electron 截图验收另行记录，不以目录页代替。

## 验证

运行 `pnpm --filter @archer/ui build`、`pnpm --filter @archer/desktop typecheck`、`pnpm exec vitest run tests/ai-ui` 及相关 Lint。目录测试检查运行时导出覆盖、路由唯一、示例源码非空、各状态可渲染、覆盖链接有效及预览框架的分类布局与状态工具栏。核心行为测试检查确认结果不冒充成功、Terminal 未知不变失败、Task 不冒充 Plan、消息转义，以及来源协议限制、空来源、堆栈帧和测试结果只读。

浏览器检查目录搜索、直接地址与历史导航、状态切换、Preview / Code / Usage / Source 四个视图与方向键、示例复制、运行指示与折叠过渡、reduced-motion、来源展开与无效协议、建议回调、堆栈展开、测试结果状态、授权决定历史、终端输出追加、运行 / 完成计划、Patterns 的人工交互、明暗切换及窄窗口溢出。构建和静态渲染不能替代实际交互与截图验收。

## 官方基线对照

`/agent-ui.html#/reference` 提供固定 Rhea + Neutral 的左右对照：左侧保留官方配色，右侧只映射 Archer 当前语义颜色与字体。两侧共用官方组件源码、配套 CSS 和交互样例，并使用独立文档隔离 Desktop 全局样式。支持明暗、强调色和运行/完成/失败状态，以及输入、选择、弹窗、浮层、Trace 与代码复制。

此入口用于确认组件造型与主题适配；正式页面已使用同一份包实现，对照页仍只随 Vite 开发预览提供，不加入桌面生产入口。正式对话页、Agent 事件、Runtime 和授权机制不受影响。复制范围、原始源码校验值、MIT 许可和使用限制见 [样板来源说明](../../apps/desktop/renderer/src/ui/ai-ui/playground/reference/README.md)。Tool/Plan 样例使用官方 Trace 组合，不额外建立消息状态系统。

验收时对照相同宽度下的控件高度、圆角、边界、组内间距与交互焦点，再检查明暗和强调色。字体映射允许自然换行变化，不允许主题覆盖结构尺寸。修改正式组件前应先以该页确定视觉基线。

对照页提供独立的界面主题选择（Graphite、Midnight、Slate、Warm）、强调色与明暗选择，复用现有全局 Token，不新增主题刻度。页面中的来源说明可展开查看固定 revision 的具体官方文件链接，区分官方组件与 Archer 自编的组合样例。完成态提供最终答复样例；工具失败只表示局部活动失败，不将计划同步推断为失败。弹窗输入使用独立草稿，保存后更新样例，取消不修改样例。

## 全组件总览与实现源码

默认入口 `#/overview` 按 Primitives、AI、Renderers、Patterns 展示组件家族，支持沿用左侧搜索筛选。一个家族只显示一张入口卡，子组件在卡片中列出并保留自己的侧栏入口和预览页；点击卡片进入主组件的完整组合。总览只提供导航，不同时挂载所有示例，避免交互状态、模态与滚动容器相互干扰。

每个组件页提供四个视图：Preview 为实际组件示例；Code 为该示例的 TSX；Usage 为属性与边界；Source 为 `packages/ui/src` 的实际实现文件。多个子组件共用文件时展示完整文件，不伪造独立实现。Patterns 的 Source 显示场景组合代码。源码以 Vite 的 raw import 读取，不维护第二份文本副本。

来源明确区分官方源码改编与 Archer 本地实现。Trace、Collapsible 提供固定 revision 上游链接；其他组件不因参考了官方模式就标成复制。来源说明遵守 `packages/ui/THIRD_PARTY.md`。对照页中的 Rhea 样板与当前组件目录是两个范围，不代表全部组件已切换到官方造型。

## Trace 的完整示例与局部示例

Trace 页面使用完整对话示例：用户问题、连续工具行、默认展开的输出、局部失败或运行状态以及公开答复。内容居中于最大 440px 的阅读列，避免少量活动横跨整块预览区域。所有执行内容为固定示例，不代表实际运行。

TraceLine 等子组件仍使用局部组合示例，限制阅读宽度。组件新增 `density="compact"`：元信息紧随标题、箭头靠近动作，输出使用缩进和边界引导线。默认 `standard` 保留现有布局；正式页面不自动切换密度。新密度使用 Archer 语义 Token，不复制硬编码品牌色，不新增运行状态。

Tool、Plan、Task、Reasoning 的独立示例共用最大 480px 的阅读列、公开说明、紧凑 Trace 和弱化的边界说明。Tool 保留运行、失败与未知结果的不同文案；Task 展开实际活动输出；Plan 默认展开以便查看完成步骤与比例，但进度始终标明模型声明；Reasoning 使用固定且允许公开的文本，提供追加片段交互，不生成或读取原始推理。该编排只改变 Playground 示例，正式页面不自动采用。

AI 独立文档与基础组件共用 760px 文档宽度，Plan 完整示例采用最大 440px 阅读列，包含用户请求气泡、四步计划、当前公开反馈与重置动作。等待、运行、完成使用同一内容结构。Plan 的 `showProgress` 和 `showStepStatus` 默认均为 true；示例显式关闭两者，以标题完成数和步骤图标表达声明进度，减少重复视觉元素。此开关仅影响展示，不改变计划状态与完成判断。紧凑 Trace 使用全局正文字号而非缩小正文，辅助元信息继续使用 caption 刻度。

## 统一预览框架

所有组件与 Patterns 的 Preview 统一经过 `PreviewFrame`，集中维护状态工具栏、画布、内容列、响应式留白及本地交互说明，不再由各组件页面创建不同预览外框。文档页统一最大 760px，完整工作区为 1040px。普通基础组件与 AI 组件共用 440px 内容列，代码阅读为 640px，工作区按画布完整宽度展示。示例内的内容结构可以不同，但不再决定外部展示比例。

布局选择只依据目录分类，由 `previewLayout` 集中定义；新增组件自动继承。示例不得另设画布背景、阴影、状态工具栏或页面宽度。小控件不会强制拉伸，表单、卡片和正文按组件自身语义排版。此规则只适用于 Playground，不改变正式 Desktop 的布局。

## Desktop 消费范围

Desktop 的单行与多行文本输入统一使用 `@archer/ui` 的 Input 与 Textarea，保留原生属性、表单校验、焦点与业务回调。复选框、文件选择、隐藏字段及 Markdown 任务列表保持各自原生语义，不强行替换为文本输入。

正式对话中的计划步骤通过 Plan 展示，状态映射仅将 Contract 的 `in_progress` 转为展示值 `running`，其余使用已提交声明。连续已完成工具组使用 ActivityGroup 与紧凑 Trace；分组边界、当前调用、错误与未知状态仍由 Desktop 原投影决定。原始 Markdown 高亮、Mermaid、数学与 Diff 阅读能力保留，不用简化 CodeBlock 替换成熟阅读器。

组件库的 Sources、TestResults、StackTrace 等需要结构化数据的组件，不根据工具名或输出文字猜测后端数据；没有可靠事实的功能不插入正式消息。Playground 的模拟内容和演示按钮不进入 Desktop。

正式页面的消费映射、专用阅读器与数据边界见 [Desktop 组件库接入](desktop-ui-library.md)。组件目录用于展示完整组件能力，不要求将没有可靠业务数据的模式强制插入正式对话。


## Prompt Input 图片附件

`PromptInputAttachments` 与 `PromptInputAttachment` 在 `PromptInputHeader` 内组合展示附件。
图片附件仅显示缩略图与独立移除按钮，文件名保留在无障碍名称及大图标题中，悬停通过 Base UI PreviewCard 展示有界预览，点击或键盘激活打开公共 Dialog 大图。
大图保持比例并限制在视口内，支持关闭按钮、Esc 与遮罩关闭，关闭后焦点返回触发器。
移除按钮独立于预览触发器，不打开大图、不提交输入；非图片附件仅展示文件名与移除入口。
预览只读取当前附件 URL，不上传、不产生 Agent Effect，附件删除时预览随条目卸载。

验证：在组件目录的 Prompt Input 示例中添加图片，检查悬停、点击、键盘打开、Esc 关闭、移除和多图独立预览；长图与宽图应保持比例且不超出视口。

桌面通过 `@archer/ui` 的 `dist` 入口加载组件；修改公共组件后需执行 `pnpm --filter @archer/ui build`，发行界面还需执行 `pnpm --filter @archer/desktop build`，重新加载桌面后验证交互。仅运行 typecheck 不会更新运行产物。

桌面对话的附件入口支持 PNG、JPEG、WebP、GIF 与常见 UTF-8 文本文件（TXT、Markdown、JSON、CSV、日志及代码）。每条输入最多 4 个附件，图片每张最多 5 MiB，文本每个最多 256 KiB；PDF、Word、压缩包等二进制格式不支持。
粘贴达到 4,000 字符或 80 行的纯文本自动生成 `pasted-text.txt` 附件，保留原始内容和已输入的任务说明；短文本正常插入。附件可移除，超限或非法编码显示错误。
文本文件以 `file` 内容块记录名称及正文，模型收到作为用户数据的文本投影，会话显示附件名称而不展开长正文。验证应包含长短文本粘贴、文本文件选择与拖入、超限、非法 UTF-8、移除及发送后的事实回放。

动作菜单使用 shadcn Base UI `DropdownMenu`、`DropdownMenuTrigger`、`DropdownMenuContent` 与 `DropdownMenuItem`。侧栏项目、会话操作与任务导航共用该组件；触发器通过 `render` 复用按钮，避免嵌套按钮。优先使用已有 shadcn 组件，只有现有组件无法表达需求时才新增自定义控件。验证使用 UI 构建、桌面类型检查及 renderer 测试；浮层位置、方向键、Esc 和关闭后焦点需在桌面窗口验收。

## 侧栏状态徽标

侧栏复用 `@archer/ui` 的 shadcn `SidebarMenuBadge` 放置行尾状态圆点与排队数量，不导出自定义 StatusIndicator。会话行不显示前置图标，标题使用原图标列的宽度。圆点颜色来自宿主语义 Token：进行中为复用 Spinner 的灰色圆环，失败为 Danger，等待确认与正在停止为 Warning；完成、已停止及无任务不显示圆点。Tooltip 与无障碍名称说明状态，圆点不表示未读。该组件提供徽标容器，圆点及状态映射由宿主提供；官方说明见 [SidebarMenuBadge](https://ui.shadcn.com/docs/components/base/sidebar#sidebarmenubadge)。

圆点与排队数共同使用一个徽标槽，预留独立菜单列和标题省略空间；徽标允许指针悬停以显示提示。验证包含状态映射测试、UI 构建、桌面类型检查；实机检查长标题、排队数与菜单、深浅模式及悬停说明。

会话标题末端使用透明遮罩渐隐，超出宽度直接隐藏，不显示省略号，不覆盖选中背景。状态槽固定在行尾最右侧，菜单在其左侧悬停或键盘聚焦时显示，排队数位于菜单左侧，预留空间防止标题位移。完成与已停止不显示提醒；不以完成事实推断未读，不展示缺少查看记录支撑的完成蓝点。验证包含长短标题、窄侧栏、深浅主题、菜单聚焦、状态和排队数同时出现。

会话按钮铺满所在行宽，背景包含右侧状态与菜单区域，不以标题内容决定按钮宽度。标题仅在末端 8px 内渐隐；选中背景使用 `--accent-subtle`，悬停使用 `--accent-subtle-hover`，跟随预设或自定义强调色；正文保持正常颜色，不增加彩色描边。鼠标点击不显示外侧强调色焦点环，键盘导航保留中性行内细描边。验收检查短标题背景同宽、状态点位于背景内、长标题末端渐隐以及鼠标与键盘焦点区别。

## 公开导出与目录一致性

每个公开运行时导出只对应一个目录条目；DropdownMenu 家族共用一个示例，不额外建立重复 Menu 条目。Resizable 家族包含 usePanelRef，示例通过 panelRef 关联面板，展示宿主取得尺寸控制引用的入口。

目录一致性由 tests/ai-ui/explorer.test.ts 对照 packages/ui/src/index.ts 的运行时导出检查，同时渲染各个示例状态。文档与示例调整后运行 `pnpm exec vitest run tests/ai-ui --maxWorkers=2` 和桌面类型检查。工作台尺寸偏好只保存有限像素值与最小宽度，容器负责上界；变更阅读区在容器测量前默认收起文件树，静态测试不把尚未展开的目录误认为缺失能力。

文档视图切换复用公共 Tabs；Checkbox 提供默认、选中和禁用状态。
CodeBlock 家族的各个条目共享完整组合示例，CodeSnippet 单独提供正文、折行和变更行示例。
