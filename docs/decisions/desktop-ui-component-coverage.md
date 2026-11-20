# Desktop 全功能组件复用边界

## 范围与来源

本文覆盖 Archer Desktop 当前主窗口、导航、会话、活动、文件检查器、设置及其编辑器、人工交互、异常恢复和全局视觉。表格是组件选型与职责映射，不等于每一行都已接入；基础层与对话层的实际接入状态见下文「当前接入状态」，其余候选仍按需评估，也不授权改变业务流程。

盘点入口：`apps/desktop/renderer/src/ui` 下的 layout、navigation、workspace、panels、settings、primitives，以及 `packages/ui/src`。设置当前包含通用、外观、快捷键、模型、上下文、能力来源、对话记录、工作区、关于九类。技能详情与创建、导入作为能力来源相关子页面单列。

官方依据：

- [组件目录](https://ui.shadcn.com/docs/components)：通用控件和阅读组件。
- [AI Elements](https://ui.shadcn.com/docs/ai-elements)：复制进项目的组合模式，不要求使用整套 AI Runtime。
- [Trace](https://ui.shadcn.com/docs/components/base/trace)：工具、计划、推理等的统一行结构。
- [Sidebar](https://ui.shadcn.com/docs/components/base/sidebar)：分组、子项、操作、底部区及折叠。
- [Field](https://ui.shadcn.com/docs/components/base/field)：标签、说明、控件、错误的表单结构。
- [Resizable](https://ui.shadcn.com/docs/components/base/resizable)：带键盘行为的面板分割。
- [Code Block](https://ui.shadcn.com/docs/components/base/code-block)：代码、日志、行号、复制、折行和增删行显示。
- [File Tree](https://ui.shadcn.com/docs/ai-elements/base/file-tree)：Collapsible 与 Button 的递归组合。
- [Plan](https://ui.shadcn.com/docs/ai-elements/base/plan)、[Tool](https://ui.shadcn.com/docs/ai-elements/base/tool)：基于 Trace 的组合与示例状态映射。

下文组件名是官方候选或 Archer 组合名称，不是现有包的导出清单。目录中存在不等于已逐个审计源码；引入前仍需检查该组件的实际依赖、许可证、接口和键盘行为。

## 复用方式

- **复制适配**：按需引入源码及必要依赖，置于 `@archer/ui`，适配现有 Token、Phosphor、中文和尺寸；不是另装一套并行主题。
- **组合**：用基础组件或官方 AI 模式组合 Archer 页面。页面数据、选择状态和服务调用保留在 Desktop。
- **保留**：已有算法、宿主能力或业务语义继续由 Archer 实现。只替换外层显示时不能重写事实。
- **不引入**：没有当前功能需求的组件不进入包，不因官方提供而新增产品能力。

## 当前接入状态

基础层与对话层已按本文映射完成接入：Button、Input、Textarea、Card、Dialog、Popover、Menu、Select、Tabs、Tooltip、Switch、SegmentedControl、Spinner、Sidebar 体系、Resizable、ScrollArea、Collapsible、Field 族与 ConfirmDialog 均从 `@archer/ui` 导入。Desktop 不再保留本地按钮视觉类、原生 `<dialog>`、手写 `popovertarget` 浮层或第二套菜单实现，弹窗、浮层与控件样式只有包内一个来源。

Agent 对话侧使用 AgentTurn、TurnSummary、ActivityGroup、Plan、PlanHistory、Reasoning、Tool、InteractionCard、InteractionRecord、ExecutionNotice 与 AssistantAnswer。事件顺序、未知与受阻状态、计划修订、公开反馈与流式提交仍由 EventTimeline 的既有事实投影决定，组件只负责展示和回调，不接管分组、授权或恢复。

Playground 额外展示尚未出现在正式页面的只读组件（Sources、InlineCitation、Suggestions、StackTrace、TestResults、Task、Confirmation、Terminal、CodeBlock、ConversationViewport 等）。它们需要真实结构化输入或新的业务流程才进入正式页面，组件存在不等于应新增对应区域。四套中性主题与强调色的全部组合、窄窗口与检查器展开后的边界仍需按验收要求逐项核对。

## 窗口与全局导航

| 当前功能 / 入口 | 可复用组件 | 方式与边界 |
| --- | --- | --- |
| Electron 标题栏、交通灯、拖动区、窗口控制 / layout | Button、Tooltip | 组合；原生窗口行为、拖动排除区与平台差异保留 |
| 应用窄栏 / App | Button、Tooltip、Separator | 组合；保持 44px 应用窄栏，不照搬后台导航 |
| 项目与会话侧栏 / Sidebar | Sidebar、SidebarGroup、SidebarMenu、Collapsible | 复制适配；保持既有宽度、滚动区和中性选中态 |
| 项目目录展开、当前项目定位 | SidebarMenuSub、Collapsible | 组合；工作区归属和默认展开策略由 Desktop 决定 |
| 会话项、运行状态、排队数量 | SidebarMenuButton、Action、Badge | 组合；状态只来自已有事实，不推断成功 |
| 侧栏折叠与快捷键 | SidebarTrigger、Tooltip、Kbd | 组合；受控绑定现有 store，避免双重快捷键和偏好存储 |
| 搜索对话 | InputGroup、Input、Empty | 组合；保留现有筛选。Command 仅适合另有需求的命令检索，不能顺带新增命令面板 |
| 项目和会话操作菜单 | DropdownMenu、ContextMenu | 复制适配；隐藏、重命名、删除的语义保留 |
| 打开工作文件夹 / WorkspaceDialog | Dialog、Field、Input、Button | 组合；系统目录选择和绝对路径校验仍由宿主完成 |
| 会话重命名 / Sidebar | Dialog、Field、Input | 组合；保存、冲突、长度限制不改变 |
| 会话删除 / SessionRemoval | AlertDialog、Button | 组合；删除范围、活跃任务限制与结果未确认不能降级为普通提示 |
| 历史恢复异常 / RecoveryRecordsPanel | Item、Collapsible、Dialog、Alert | 组合；隔离、重试及原始错误由服务事实决定 |
| 服务连接状态 / Sidebar | Tooltip、Spinner、Badge | 组合；连接失败不等于任务失败 |
| 会话 / 活动 / 上下文页签 | Tabs | 复制适配；三页保持挂载并保留滚动位置、已选记录与请求选择 |
| 上下文扫描 / ContextPanel | Resizable、ScrollArea、Tabs、Collapsible、Tooltip、SegmentedControl、Item、NativeSelect | 复制组合；左阅读区与右事实区可拖动，各自滚动；字符占用与条目分组共用 Collapsible，条目分组默认收起、搜索命中或条带定位时展开；字符条带与 Token 趋势摘要、柱、折线用业务 CSS 与内联 SVG 表达，不引入图表组件 |
| 检查器分栏、拖动与收起 / InspectorWorkspace | Resizable、Button、Tooltip | 候选复制适配；保留 320–420px、主区比例上限及键盘调节规则 |
| 检查器最大化、专注模式、Esc 返回 | Button、Tooltip | 组合；不是简单 Sheet，布局状态与焦点返回由现有工作台管理 |

## 首页、对话与输入

| 当前功能 / 入口 | 可复用组件 / 模式 | 方式与边界 |
| --- | --- | --- |
| 新对话首页 / NewAgentForm | Empty、InputGroup、Prompt Input | 组合；品牌与有限阅读宽度保留，不套聊天网站模板 |
| 用户消息、图片、时间与复制 | Message、Bubble、Attachment、Button | 组合；保持用户消息原文及图片历史 |
| Agent 名称、时间、操作 | Message、Avatar、Button、Tooltip | 组合；品牌图标独立于功能图标 |
| 公开进度反馈 | Message 正文、Typography | 组合；开放段落，不能由原始推理生成标题 |
| 最终 Markdown 答复 / Markdown | Message、Typography、Code Block | 复用外壳；正文解析、流式块与交互由 Streamdown 统一提供，链接与图片安全规则保留 |
| 引用、表格、列表、公式、Mermaid、图片 | Typography、Table、Code Block、图片浮层 | 组合；KaTeX、Mermaid、Shiki 与 SafeImage 现有能力保留，官方 UI 不是解析引擎 |
| 对话跟随、历史阅读、回到最新 | Message Scroller | 候选复制适配；先与 ConversationViewport 比较行为，最终只保留一套滚动实现 |
| 文本输入、发送、输入法、换行 / Composer | Prompt Input、InputGroup、Textarea、Button | 组合；提交、排队、补充输入和草稿机制保留 |
| 图片添加、预览、移除 / PromptInput | Prompt Input、Attachment、InputGroup | 使用官方附件上下文；支持粘贴、拖拽与附件菜单，保留四张与 5 MiB 限制 |
| 模型与推理等级选择 / ComposerControls | Model Selector、Combobox、Select | 组合；能力校验、中文等级及任务快照保留 |
| 授权模式菜单 | DropdownMenu、Item、Separator | 组合；明确当前任务与默认设置作用域，不能使用默认 SDK 审批语义替代 |
| 当前计划入口 / CurrentPlan | Trace、Collapsible、Popover（仅在规范允许时） | 组合；保持输入区上方轻量入口，默认沿用当前展开规则，不自行改成浮层 |
| 输入队列 / QueuePanel | Queue、Item、Button | 组合；队列接受、消费、暂停、删除与幂等由 Runtime 管理 |
| 停止任务与正在停止 | Button、Spinner、Tooltip | 组合；取消请求不等于停止完成 |
| 导出与复制 | DropdownMenu、Button、Toast | 组合；格式生成和文件保存由现有 export / Electron 完成 |

## Agent 执行与人工交互

| 当前功能 / 入口 | 可复用组件 / 模式 | 方式与边界 |
| --- | --- | --- |
| 单轮累计摘要 / TurnSummary | TraceLine、TraceDescription、Badge | 组合；一轮一个，诊断与终态分别表达 |
| 文件变更入口 / FileChanges | Collapsible、CollapsibleTrigger、CollapsibleContent、Item、ItemMedia、ItemContent、ItemTitle、ItemDescription、ItemActions、ScrollArea、Tooltip | 业务组合；TaskInsights 只投影事实，顶栏负责折叠，文件行负责跳转右侧阅读区；长列表只滚动文件区；无 Badge 原语，状态胶囊沿用语义 Token |
| 连续工具活动组 / ActivityGroup | Trace、TraceCollapsible | 复制组合；不能跨公开反馈、询问和授权边界重排 |
| 单个文件读取、搜索、命令与写入 | Tool、TraceLine、Code Block | 复制组合；短标题、目标、耗时与完整参数分层 |
| 工具输出与原始数据 / ToolOutput | Code Block、Tabs、Collapsible | 组合；显示截断需明确，原文可查，不将 JSON 当用户答复 |
| 原始推理 / 完整活动 | Reasoning、Trace | 复制组合；来源与可公开性由 Archer 校验，不默认出现在主对话 |
| 计划创建、修订与步骤 / PlanProgress | Plan、Trace、Progress | 复制组合；声明进度与实际执行结果分开，版本历史保留 |
| 无计划的执行过程 | Task、Trace | 组合；不补造 Plan、阶段或百分比 |
| 命令待授权 / PendingInteraction | Confirmation、Item、Code Block、Button | 组合；完整命令和范围明确，回调仍使用现有授权端口 |
| 完全访问确认 / FullAccessDialog | AlertDialog 或 Dialog、Field、Button | 组合；固定 turnId / revision / 等待项，取消优先，原子授权语义保留 |
| 人工问题、选项、输入与校验 | Questionnaire、RadioGroup、Checkbox、Textarea、Field | 组合；按真实问题 schema 和现有交互能力展示，不默认增加新题型 |
| 已回答、已授权记录 | InteractionRecord、Item | 组合；原位置折叠，问题、选项、答案、范围不丢失 |
| 执行失败、未知、受阻、提交未确认 | Trace、Alert、Item | 组合；不能全映射为 error。unknown 不自动重试 |
| 失败后恢复与已处理错误 | Trace、Badge、Collapsible | 组合；局部失败不覆盖最终成功，未解决问题不能被完成状态隐藏 |
| 上下文整理提示 / ContextCompaction | Marker、Spinner | 组合；执行中只留一处轻提示，结束后不进入答复；逐请求采用状态与估算在「上下文」页签，不生成多张进度卡 |
| 完整活动时间线 / EventTimeline、EventPanel | Trace、Tabs、Select、Code Block | 组合；保留事件原序、编号、筛选和加载范围 |
| 会话已知字段 | Item、Badge | 组合；只列工作区、执行状态、记录数、队列与文件数，不推算进度 |

## 文件、代码、Diff 与检查器

| 当前功能 / 入口 | 可复用组件 / 模式 | 方式与边界 |
| --- | --- | --- |
| 修改文件目录 / ChangesPanel、change-tree | File Tree、Collapsible、Button | 复制组合；只展示工具确认的变更，不扫描工作区磁盘 |
| 文件路径与导航 | Breadcrumb、Tooltip、InputGroup | 组合；长路径省略但完整可读，筛选不误清当前阅读对象 |
| 源码、日志与行号 | Code Block | 复制适配；已有 Shiki 能力与用户高亮、行号偏好保持一致 |
| 增删行 Diff 外观 / HistoricalDiff | 包内 HistoricalDiff（diffLines） | 已抽取到 `@archer/ui`；宿主只传 before / after，组件不读取文件、不补造缺失原文 |
| 差异计算与片段配对 | HistoricalDiff 内的 diffLines | 计算留在组件内；哪些片段属于同一文件仍由审阅按任务事实决定，不能拼接未经证明的连续修改 |
| 原文缺失、仅有 after | Empty / Item + Code Block | 组合；明确原文未记录，不能把未知 before 当空文件 |
| 同文件多个历史修改片段 | Collapsible、Separator、Code Block | 组合；不能拼接成未经证明的单次连续修改 |
| 源码 / 差异 / Markdown 预览切换 | Tabs 或单选 ToggleGroup | 组合；保持原有阅读模式与选中路径 |
| Markdown 文件预览 | Message / Typography 外壳 | 复用 Archer Markdown 引擎，避免第二套解析和高亮行为 |
| 文件新增 / 修改 / 删除与行数 | Badge、TraceDescription | 组合；行数未知时明确未知，不补算不存在的原文 |
| 并排 Diff、字符级对齐、折叠块、超大文件虚拟化 | 官方上述 Code Block 不能直接包办 | 当前按既有功能保留；若要求专业对比器，需另立需求评估，不能宣称复制 Code Block 即支持 |
| 打开文件、外部链接、复制路径 | Button、DropdownMenu、Tooltip | 组合；受控资源访问、系统打开与路径限制属于 Desktop / 宿主 |

## 能力来源阅读

| 当前功能 / 入口 | 可复用组件 | 方式与边界 |
| --- | --- | --- |
| 能力来源 / ProviderBrowser | Item、Tabs、Collapsible、Badge | 组合；全局只读浏览，Provider、Capability、Contract、revision 分开展示 |
| 来源列表到详情、技能资源导航 | Breadcrumb、Item、File Tree | 组合；不暴露内部容器路径寻址，不构建新 Registry |

请求上下文、会话概览、调用详情与请求级能力来源已从中间工作区移除；历史请求快照不再提供阅读入口。

## 设置工作区与子页面

设置页不是一个现成 AI Element，而是 Sidebar、Field、表单控件、列表及 Dialog 的组合。保留设置的即时保存与显式保存边界，不引入新的配置状态管理。

| 当前功能 / 入口 | 可复用组件 | 方式与边界 |
| --- | --- | --- |
| 设置分类、分组、搜索、返回 / Settings | SidebarGroup、SidebarMenu、SidebarMenuItem、SidebarMenuButton、InputGroup、Item、Empty | 组合；分类是页面级导航（`aria-current`），只取菜单原语不套侧栏外壳，九类设置结构与返回会话状态保留 |
| 设置标题、作用域、说明 | Typography、FieldDescription、Badge | 组合；本机即时 / 服务保存 / 当前只读必须清楚 |
| 通用：默认工作区和模型 | Field、Select / Combobox、Button | 组合；默认值只影响既定作用域 |
| 通用：文件访问、启动位置 | RadioGroup、ToggleGroup 或现有 SegmentedControl | 单选组合；不使用无选中约束的多选切换 |
| 外观：明暗与跟随系统 | 单选 ToggleGroup / SegmentedControl | 组合；沿用系统监听，不引入 next-themes 并行状态 |
| 外观：四套中性主题缩略卡 | RadioGroup + Button / Item | Archer 组合；缩略预览读同一 Token，不照搬主题生成站 |
| 外观：强调色单选、自定义 HEX | RadioGroup、Input、FieldError、原生 color input | 组合；HEX 校验与 Accent Token 独立，中性主题不被覆盖 |
| 外观：字号 | 单选 ToggleGroup / SegmentedControl | 组合；使用现有全局字号刻度 |
| 外观：代码高亮、行号 | Switch、Field | 复制适配；设置必须作用于所有代码阅读入口 |
| 外观：可折叠实时预览 | Collapsible + 实际组件样本 | 组合；不复制第二套业务主页或另存偏好 |
| 快捷键参考 | Kbd、Item、Table | 组合；只列平台实际支持的操作 |
| 模型：推理方式、默认服务 | Field、Select、RadioGroup | 组合；保留模型能力与明确默认选择规则 |
| 模型：服务 URL、凭证、模型字段 | Input、Field、FieldError、Button | 组合；凭证遮蔽、保存行为与服务错误仍由现有逻辑处理 |
| 模型：服务 / 模型新增和删除 | Item、Collapsible、AlertDialog | 组合；不因组件引入自动发现或新 Provider 安装能力 |
| 上下文：策略列表、模板、克隆与编辑 | Item、Select、DropdownMenu、Field | 组合；保留 Profile 快照与显式保存 |
| 上下文：步骤启用、排序与移除 | Switch、Button、Collapsible | 组合；沿用上移下移，不默认引入拖拽系统 |
| 上下文：ANY / ALL、阈值、预算、推理等级 | RadioGroup、Select、Input、FieldError | 组合；数值校验和求值仅由既有契约与 Handler 负责 |
| 能力来源：只读声明和来源详情 | Item、Badge、Collapsible、Code Block | 组合；UI 不变成插件安装管理器 |
| 技能正文和 references / scripts / assets | Typography、Code Block、File Tree | 组合；保留加载、资源范围和脚本审批边界 |
| 技能创建 / 导入 / 编辑 / SkillLibraryEditor | Field、Input、Textarea、Button、Dialog | 组合；文件读取、内容校验、保存与待重启加载语义保留 |
| 对话记录管理 / SessionManager | InputGroup、Item、DropdownMenu、AlertDialog | 组合；保留打开、重命名、删除和活跃任务限制 |
| 工作区管理 / ProjectManager | Item、Button、Dialog、DropdownMenu | 组合；隐藏侧栏不等于删除目录 |
| 关于与服务运行信息 | Item、Badge、Separator、Button | 组合；版本和健康信息来自真实宿主数据 |
| 未保存退出、取消、删除确认 | AlertDialog / Dialog | 统一组合；保存期间禁用规则、丢弃范围和焦点恢复保留 |

## 全局状态与非覆盖项

| 类别 | 可复用 | 必须保留或明确不支持 |
| --- | --- | --- |
| 加载、空、错误、成功反馈 | Skeleton、Spinner、Empty、Alert、Toast | 业务错误解释与重试条件；重要待处理项不能只用会消失的 Toast |
| 帮助、悬停说明、动作菜单 | Tooltip、HoverCard、DropdownMenu、Popover | 不在 hover 中放必须完成的交互；菜单定位与遮挡实测 |
| 长列表和滚动条 | Scroll Area、Item、Table | Scroll Area 不是虚拟列表，不声称自动解决海量事件性能 |
| 焦点、快捷键、无障碍 | 官方原语与受控开关 | Electron 平台快捷键、输入法、模态嵌套与阅读位置需实测 |
| 深浅、中性主题、强调色、字号 | 官方组件的样式接口 | Archer design-tokens.css 是唯一值源，禁止第二套主题 Provider |
| Markdown、公式、Mermaid、Diff 算法 | 展示外壳 | 继续使用现有解析与计算依赖；这些不是 shadcn 的完整替代范围 |
| 文件系统、导出、系统窗口、服务管理 | 控件表面 | Electron 与现有 Client / Server 保留 |
| 事件、串行提交、授权、队列、恢复 | 展示映射 | Agent / Runtime / Camp / Contract 不变；UIMessage 不替换事件事实源 |
| Subagent、Checkpoint、任意文件上传、图形工作流 | 暂不引入 | 官方有模式不表示 Archer 当前具有这些能力，不新增假入口 |
| Chart、Calendar、Carousel、OTP、音视频 | 暂不引入 | 当前需求不足，不为凑组件数量引入 |

## 包结构与集成约束

保持一个 `@archer/ui`。通用控件留在 primitives，AI 组合留在 ai；代码、文档等渲染器只有在实际抽取时进入 renderers，不建空目录。应用页面和业务适配仍在 Desktop。公开入口统一，内部可以模块化，不以此次清单为由进行目录大迁移。

同一基础控件只能有一个最终实现。已有 Button、Input、Dialog、Popover 等应逐项对照成熟源码；质量满足时复用已有实现，需要替换时统一替换，不保留 shadcn 与 Archer 两条并行视觉路径。依赖的交互原语按组件实际需要选择，不同时引入多个完整原语体系。

复制源码时记录来源路径、revision 和许可证，保留必要版权声明；依赖只安装必要项。官方示例的 Lucide、Tailwind 类、AI SDK 数据映射、默认快捷键与主题状态都需要核对，不盲目复制。官方页面及示例可变，本文是候选映射，不是已锁定依赖清单。

官方 Tool 示例把流结束后缺少输出的调用映射成失败，不适用于 Archer 的未知副作用；批准不等于已开始或成功。计划完成计数仅表示模型声明。原始推理只在来源允许的位置阅读。这些规则在 Desktop 投影与现有事实中表达，不引入第二套执行 Runtime。

## 验收要求

基础控件验收包含默认、悬停、键盘焦点、禁用、校验错误、提交中、Esc、外部点击、焦点恢复与窄窗口边界。导航验收包含展开、隐藏、长标题、行尾操作与滚动保持。设置验收包含九类页面、未保存退出、保存失败与即时偏好作用域。文件验收包含长路径、原文未知、多片段、增删行、复制、折行与最大化。

对话验收覆盖无计划、运行计划、完成计划、失败恢复、人工询问穿插、命令授权、未知结果及最终答复。用户手动展开不因事件更新收起，公开文本与工具保持真实顺序，流式提交不重复。

主题验收覆盖 light / dark、中性主题、强调色及字号组合的代表状态；检查普通桌面、窄窗口和检查器展开后的实际可用宽度。先验收独立 Playground，再接业务页面。类型检查、构建和行为测试不能替代实际截图比较；复制源码并不自动意味着视觉验收通过。
