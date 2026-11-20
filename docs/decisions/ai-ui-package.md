# 统一 UI 组件包

`@archer/ui` 是私有 React 展示组件包，不是 Agent Runtime。它不依赖 contracts、runtime、client 或 apps，不请求服务，不管理授权，也不决定事件分组。应用传入展示数据、内容插槽与交互回调。

公开组件包含 AgentTurn、MessageHeader、ProgressParagraph、ActivityGroup、Plan、InteractionCard，以及 Sources、InlineCitation、Suggestion、StackTrace、TestResults 等只读内容组件。图标支持 ReactNode 插槽或包内 Phosphor Icon；业务按钮通过动作插槽提供，基础 Surface 位于同包，不反向依赖 Desktop。包样式通过 `@archer/ui/styles.css` 显式引入，消费现有全局语义 Token，不复制主题。

Plan 步骤状态独立于任务终态：组件默认折叠，宿主可按运行状态选择初始展开，展开选择不由任务终态推断；比例仅表示传入声明。ActivityGroup 只负责折叠展示，连续区间由应用保证。稳定业务身份由宿主提供，组件不读取日志、不猜测工具意图。

独立 `/agent-ui.html` Playground 已消费包中的消息头、公开反馈、工具组和计划；正式 Desktop 会话、设置与检查器已从包导入基础控件、对话组件和计划组件，不再保留应用内并行的按钮、弹窗或浮层实现。开发前构建组件包：`pnpm --filter @archer/ui build`。工作区完整构建按依赖先构建组件包，再构建 desktop。

验证使用组件公开行为测试、包构建、desktop 类型检查，以及在隔离 Electron 实例中用真实模型轮次取得的明暗、运行中、完成、失败、人工确认与复杂 Markdown 截图。视觉验收单独进行，不能由类型检查替代，也不以演示夹具冒充正式页面。

## 对话组件与界面状态

ConversationViewport 提供底部跟随、回到最新与历史加载锚定。宿主在向前插入历史时更新 historyKey；普通追加不改变该值。ResizeObserver 监听内容尺寸，用户离开底部后停止跟随。该组件不请求事件、不恢复会话。

TurnSummary 接收宿主明确给出的 TurnStatus，区分等待授权、等待回答、正在停止、完成、失败、停止和受阻；附加诊断与主状态独立存在。AssistantAnswer 通过内容插槽复用宿主 Markdown，并提供结果与操作区域。InteractionRecord 保留原始问题和回答，默认折叠。ExecutionNotice 区分 unknown、blocked、unconfirmed、error，不自动重试。MessageHeader 支持宿主操作区。

Playground 通过组件包使用上述组件，不复制其实现。组件内折叠、滚动属于临时 UI 状态，不进入 Agent Journal。正式桌面页面与 Playground 共用同一份组件实现，业务状态仍由真实事实驱动；演示回答不代表真实授权，也不进入持久化会话。

## 只读内容组件

Sources / Source 展示宿主提供的来源条目，空列表不渲染空壳；只有 http / https 地址进入可点击入口，其他协议只保留编号、标题和说明。InlineCitation 使用同一协议限制。两者都不抓取链接，也不判断来源可信度。

Suggestion / Suggestions 只回调宿主选择，不自动提交消息；禁用条件由宿主传入。StackTrace 只阅读结构化帧，不解析原始堆栈字符串，缺失的函数名、行号与列号保持缺失。TestResults 只统计传入用例并展示失败详情，不执行测试，也不重算套件结论。

这些组件属于纯展示，不新增 Tool、Effect、授权或恢复能力，也不改变 Agent 事件来源。示例中的链接、帧和测试结果都是固定数据，不访问网络或本地文件。


## 运行态与动效

运行中的 Task、Tool、Plan、Reasoning、Terminal 与 TurnSummary 使用同一旋转指示，运行标题使用克制的扫光提示；完成或失败状态立即停止，不以动画推断进度或成功。旋转环可由已有语义色驱动，旁边已有状态文字时对辅助技术隐藏；独立出现时提供“运行中”等可读名称。

折叠内容的展开与收起使用高度与透明度过渡；按钮按下、分段选择、对话框和浮层出现各有一条短过渡。所有动效只改变呈现，不延迟事实提交、授权决定或焦点恢复。`prefers-reduced-motion` 下移除旋转、位移和过渡，但保留静态运行指示与状态文字。

动效属于临时 UI 状态，不进入 Agent Journal，也不作为“任务正在执行”的独立事实来源；断连、超时和取消仍按既有事实与恢复规则表达。

## 内部分层

统一包名为 @archer/ui。primitives/Record 提供公共记录表面，ai/elements 提供基础 AI 展示，ai/conversation 提供状态、答复与交互记录，ai/ConversationViewport 管理临时阅读位置。根 index.ts 统一导出，不保留旧包名或双实现。

Desktop 在全局 CSS 中引入包样式，公共记录样式随 Record 源码一起归包；现有桌面 Record 入口仅引用包实现。全局主题 Token 仍只有 design-tokens.css 一个来源，不先拆出第二份 themes。未实现的 renderers、registry、reducers 不建空占位。后续只有可独立复用的基础组件才进入 primitives，桌面窗口及业务装配留在应用。未来 Web 的源码复用边界仍遵守项目约束，不因统一包而自动复用桌面布局。

## 基础交互组件

Button、Input、Textarea、Card、Switch、Tabs、Tooltip、Dialog、Popover、Menu、FloatingSurface、DialogHeader、DialogActions、FormField、ConfirmDialog、Icon、Select 和 SegmentedControl 的实现位于包内 primitives。Desktop 直接从 @archer/ui 导入，不保留应用内复制实现。Phosphor 是包的显式依赖，Icon 保持原有语义名与 regular 轮廓。

Button、Input、Card 采用固定 revision 的 shadcn/ui Base UI 官方源码：保留官方 JSX 结构、`cn-*` 类名、variant / size 设计、Base UI 交互原语与无障碍属性，只做本地导入、Token 映射和少量几何适配。Button 的视觉层级为 default、secondary、outline、ghost、destructive、link，尺寸为 xs、sm、default、lg 与 icon 系列；Input 保留原生表单约束和错误属性；Card 采用 Header / Title / Description / Action / Content / Footer 组合。Desktop 调用点显式声明 secondary 或 default，不把默认层级改成中性来规避迁移。

样式通过包内 `theme/shadcn.css` 桥接：`@theme inline` 把官方语义颜色映射到 Archer Token，`dark:` 改绑 `data-appearance`，字号跟随桌面文字大小设置，圆角与卡片内距使用结构刻度。Tailwind v4 由宿主处理，`styles.css` 显式声明扫描本包源码；包内样式用 `@reference 'tailwindcss'` 引用默认主题，宿主单独编译该 CSS 时 `@apply` 仍可解析且不重复输出基础样式。组件不引入第二套主题或 Agent Runtime。来源、许可证与本地改动见包内 [THIRD_PARTY.md](../../packages/ui/THIRD_PARTY.md)。

Select 保留既有原生选择器及 selectedcontent 适配。Dialog、Popover、Menu、Textarea 与 Tabs、Tooltip 均已在包内实现并由 Desktop 直接导入：Dialog 使用原生模态与 `showModal`，尺寸只有 small / medium / large 三档并只约束阅读宽度；Popover 使用原生 auto popover 与有界定位，Menu 在 Popover 之上补齐 roving tabindex、方向键、Home / End 和关闭后焦点返回，自定义触发器通过 `PopoverTriggerProps` 转交锚点属性。ConfirmDialog 保留原生模态、取消焦点与 Esc 关闭语义。此次迁移不改变表单提交、授权或配置保存流程。

## 基础层参考与验收入口

基础层以 shadcn/ui 的 Base UI 版本为基准，固定 revision `e62c9435fff729a175f38983dee73b2cb4f6a069` 的 Rhea 样式与 Neutral 配色。Button、Input、Card、Textarea、Dialog、Popover、Menu、Select、Tabs、Tooltip 已在包内实现并接入 Desktop；Collapsible 保留现有同构实现；Badge 在包内尚无实现，需要时再对照官方源码补充。官方源码不作为运行时框架安装，只进入包内源码并由 Archer 维护，不研究 assistant-ui，也不引入它的 Runtime。

Input 保留原生表单约束和错误属性；Card 采用 Header / Title / Description / Action / Content / Footer 组合。Dialog 由 open/onOpenChange 控制，使用原生模态并恢复触发焦点；Popover 使用原生 auto popover，保持 Esc 与外部点击退出。样式消费已有 Token，主题只有一个来源。独立 agent-ui.html 中提供基础组件验收区，所有示例交互只在本地发生。

基础组件验收作为 Playground 的独立场景，不与 AgentTurn 或固定输入区混排。按钮、输入框及卡片使用同一组间距；操作区在窄窗口自动换行。示例只改变本页状态，不保存应用偏好。Playground 只验证组件本身；正式页面通过与 Desktop 的同一份实现接入，不把示例交互或演示数据带进业务页面。

Popover 根据内容实际尺寸约束可视边界，下方不足时翻到上方，展开期间监听窗口和滚动变化，关闭后移除监听。原生 toggle 同步 aria-expanded，触发按钮通过 aria-controls 关联浮层。定位纯函数测试覆盖下方、右边界、向上翻转及极小视口。Dialog 的 Esc 事件停止冒泡，避免嵌套页面同时响应关闭请求。以上测试不替代原生焦点和视觉验收。

全界面功能的组件候选、复用方式与不可替代边界见 [Desktop 全功能组件复用边界](desktop-ui-component-coverage.md)。该清单包含导航、设置、上下文、文件检查器与 Diff，不仅限 AI 对话。

## 源码基础与组合职责

公共执行行使用 shadcn/ui Trace 源码结构，Collapsible 使用 Base UI 原语。来源 revision、许可证与本地改编范围见 `packages/ui/THIRD_PARTY.md`。包内不接入 AI SDK、消息存储或另一套 Runtime。

Trace 只定义图标、标题、说明、状态和折叠结构；Tool 与 Reasoning 使用相同结构。ActivityGroup 聚合宿主提供的连续区间，Plan 在同一行语法下展示声明步骤。Plan 的完成色和进度仅作用于自身，不修改全部 Trace 行。默认展开仅用于初始化，用户手动选择不被普通重渲染覆盖；保留挂载的子项在父组收起后保持展开选择。

Tool 的视觉状态由宿主明确传入；未知结果使用真实标题和说明，不因断流推断 error。Reasoning 只接收允许展示的文本，展开选择优先于流式默认值，不自动公开内部推理。人工询问保留在活动之外，回答后替换为可查阅的历史记录。

FileTree 只渲染输入节点并返回选中路径，不读取磁盘；它采用普通导航与按钮，不冒用需要完整方向键行为的 ARIA tree。行文字使用界面字号与主文本色，文件夹/文件使用闭合与纯文件语义图标；选中态复用导航的中性选中表面与主文本色，不占用强调色，也不加投影。组件不限宽以适配检查器侧栏，Playground 只在示例容器中收敛树干宽度。CodeBlock 接收文本或已计算的增删行，支持折行、行号、复制及失败反馈，不负责差异计算和语法高亮。当前未接入正式代码阅读，不替换现有 Markdown、Shiki、diffLines 或历史片段语义。

Sidebar 提供头部、滚动主体、分组与底部结构，导航选择和折叠仍由宿主控制；行尾操作不嵌入导航按钮。Field 族统一标签、说明与错误布局；调用方通过 htmlFor、id、aria-describedby 关联，不添加配置状态系统。

Playground 提供独立的基础组件、文件与代码、侧栏与设置场景，以及六类会话场景。设置示例只改变本页主题属性，不保存正式偏好；模型地址示例只验证输入，不请求服务。文件示例使用固定增删行，不表示真实文件修改。正式设置与正式对话仍由原入口提供。

验证包括 Trace 非交互行、未知结果不改写、计划声明比例、文件路径身份、代码安全转义、导航操作不嵌套与字段关联测试；交互验收检查嵌套折叠状态保留、文件切换、代码复制、设置字段错误和明暗切换。正式 Desktop 页面已按全功能覆盖文档逐项接入，并用真实运行截图核对明暗外观、运行中与完成计划、失败与人工确认、复杂 Markdown 和弹窗键盘焦点；不同中性主题与强调色的全部组合仍按覆盖文档分别验收。

公开组件的独立 Preview、Code、Usage 页面与官方覆盖对照见 [Component Explorer](../guides/ui-component-explorer.md)。Message、Task、Confirmation、Terminal 仅增加展示和回调组合，不新增执行能力。
