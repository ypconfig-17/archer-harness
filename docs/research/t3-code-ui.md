# T3 Code 前端组件研究

## 范围与证据

研究日期：2026-11-19。依据官方仓库 main 的 apps/web 文件目录，以及直接读取的 ContextChip.tsx、AppSidebarLayout.tsx、DiffPanelShell.tsx、ui/combobox.tsx。源码读取未固定整个仓库 commit，以下链接指向 main，后续复制必须重新固定提交。未启动 T3 Code，视觉、性能与完整键盘行为未做实机验证；结论是源码层面的改编建议。

官方源码入口：https://github.com/pingdotgg/t3code/tree/main/apps/web/src/components

## 结构与组织

T3 Code 将 ui 原语放在 components/ui，业务组合放在 components；目录包含 sidebar 子目录，以及 ChatView.logic、CommandPalette.logic 等逻辑文件与相邻 browser.test 文件。AppSidebarLayout 实际承担路由、侧栏、窗口状态、快捷键和面板状态协调，依赖路由与应用 store；它是应用装配层，不适合搬入 Archer 公共 UI。

DiffPanelShell 将 header、children 与呈现 mode 分开，支持 inline、sheet、sidebar、embedded；Electron 拖动区由外壳决定。加载状态复用 Skeleton，并提供 role=status 与 aria-live。Archer 已有 Resizable、CodeBlock、HistoricalDiff，宜复用现有阅读结构，仅借鉴稳定外壳与真实加载状态。

## 值得复制改编的部分

| 优先级 | 来源 | Archer 现状 | 改编方式 |
| --- | --- | --- | --- |
| 高 | ui/combobox.tsx | 公开导出已有 Select、Popover、InputGroup，没有 Combobox | 以现有 Base UI 依赖增加组合式搜索选择器；用于长模型或项目候选，短互斥偏好继续使用 SegmentedControl |
| 中 | ContextChip.tsx | 已有附件、InlineCitation、Sources | 先对照这些组件收敛引用标签；仅在多个入口确有重复后提取 ContextChip，不一次引入全部种类 |
| 中 | DiffPanelShell.tsx | 已有审阅布局、Resizable 和 Skeleton | 在桌面业务层统一审阅标题与加载占位，不把 Electron 判断放入公共包 |
| 中 | 相邻 browser.test 与逻辑文件 | 已有组件目录和行为测试 | 给复杂选择器补中文输入法、键盘、焦点返回、窄窗及空状态示例与行为验证 |

### 可搜索选择器

T3 使用 Base UI Combobox，拆出 Input、SearchInput、Trigger、Popup、Item、Empty、List、Clear、Status。Popup 使用 Portal 与 Positioner，限制可用高度和宽度；List 使用公共 ScrollArea，另提供不包含 ScrollArea 的虚拟列表入口，避免重复滚动所有权。Popup 明确设置 no-drag，因为 Electron 拖动命中不能只靠 z-index 修复。

Archer 适合复制组件职责与组合 API，样式全部映射到现有设计 Token，图标改用公共 Icon。不要复制固定 z-index、玻璃效果、阴影、移动端字号或复杂后代尺寸选择器。是否需要虚拟列表由候选数量和实际测量决定，当前不为假设需求增加入口。候选与选中值由宿主传入，不解析 Camp、不执行能力、不改变模型选择与授权规则。

来源：https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/ui/combobox.tsx

### 上下文引用标签

ContextChip 使用 cva 表达 kind、shape、state，拆分 Label 与 Action；useRender 与 mergeProps 支持 span、链接或按钮组合。标签使用 min-w-0 和单行截断，图标不收缩；unresolved 与 invalid 分开。交互动作具有独立焦点样式，过渡尊重减少动态效果偏好。

Archer 可借鉴正文与输入区共享同一引用展示结构、长路径截断、移除动作与无效状态分离。颜色保持现有语义 Token，避免照搬大量文件类型颜色和 bubble 外形。展示状态必须来自宿主提供的已知事实，不从文件名或当前磁盘内容推断历史有效性；组合时检查按钮嵌套问题。

来源：https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/ContextChip.tsx

## 样式实现与边界

已读文件使用 Tailwind 工具类、cn 合并、CSS 自定义属性、data-slot 与 data-state；ContextChip 用 cva 管理变体，Combobox 通过 Base UI 状态属性表达选中、禁用和高亮。适合复制的是状态驱动与组合边界，不能据此宣称已完整审查 T3 全局主题体系。

Archer 已使用 Base UI、cva、cn，并集中管理设计 Token，技术基础相近。公共包继续按 primitives、ai、renderers 组织；桌面路由、窗口桥接、服务连接与快捷键留在应用层。无需复制 T3 的目录命名或引入其状态管理依赖。

## 建议落点与验证

首个可实施目标为 packages/ui/src/primitives/Combobox.tsx，并在组件目录补搜索、空结果、禁用、长名称与中文输入示例。实际实现时同步更新公共交互原语文档；验证输入法组合期间 Enter 不误选、方向键导航、Esc 关闭与焦点返回、触发器禁用、弹层避碰和 Electron 顶栏点击。

其次评估引用标签在 PromptInput、InlineCitation 与桌面消息中的重复，再决定是否提取。审阅外壳仅在桌面应用内收敛。以上变更不新增 Contract 或 Effect，不修改事实提交、执行与恢复。

本次仅新增研究文档，未修改 UI 或执行模型任务，因此没有运行构建和行为测试。尚需在真正复制代码时核对固定提交的 LICENSE、文件版权声明和 packages/ui/THIRD_PARTY.md，保留适用声明。

## 审阅功能专项

### 差异引擎与职责

StyledDiffCodeView 从 @pierre/diffs/react 导入 CodeView，并作为集中样式适配入口，引入 DiffWorkerPoolProvider。Archer HistoricalDiff 同样使用 Pierre，但当前通过 File / MultiFileDiff 展示一个路径的两侧原文。因此无需更换引擎；T3 的 CodeView API 与 Archer 当前依赖版本是否匹配仍须单独核验，不能直接复制调用。

来源：https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/diffs/StyledDiffCodeView.tsx

### 文件补取

useReviewFilePatches 将文件清单与补丁加载分开，初始请求四个文件，继续加载按四个一组，也能按路径请求或重试单个文件。查询范围包括环境、工作目录、来源与基准引用、忽略空白设置；预览 revision 更新用于刷新已加载补丁。该结构适合多文件连续审阅，避免一次取完所有内容。

Archer 当前 Git 列表只取状态，选择文件后读取两侧原文，已有按需加载。若保持单文件阅读，不必复制四文件预取；只有引入连续多文件阅读时，才值得采用批次加载。历史回执继续来自已提交事实，不能替换为当前 Git 内容。

来源：https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/diffs/useReviewFilePatches.ts

### 阅读稳定性与样式

T3 的适配层针对 split + wrap 将代码列最小宽度设为零，以避免当前挂载行改变网格自动最小宽度，导致重新换行、虚拟列表反复修正滚动。文件标题使用 sticky；搜索命中采用半透明底色保留语法色，选中行和行号区分别适配。这些是比照搬面板外观更有价值的细节。

Archer 当前 options 主要控制统一 / 并排、传统增删标记、隐藏引擎标题及代码字号。值得优先验证长行、并排切换、上下文展开、主题变化与选中文件后的阅读位置稳定性，再决定扩展公共适配层。不要直接复制 T3 的强制覆盖 CSS；需匹配当前 Pierre DOM 与 Archer Token。

### 目前建议

1. 保留 HistoricalDiff 与既有文件树及 Resizable，先收敛 Pierre 的公共主题适配。
2. 对长行与并排换行进行实际复现，有滚动跳动证据后应用相应列宽约束。
3. 评估文件切换与布局切换后的滚动恢复；状态属于本机阅读偏好，不进入 Agent 事实。
4. 多文件连续审阅、行评论和 Worker 优化需分别研究，不据组件名称推断已验证能力。此次尚未完整读到 DiffPanel、AnnotatableCodeView 和 Worker Provider 的实现，也未追踪服务端补丁生成，不能宣称这些链路已经完成审查。

对照文件：packages/ui/src/renderers/HistoricalDiff.tsx、apps/desktop/renderer/src/ui/panels/ChangesPanel.tsx、apps/desktop/renderer/src/ui/panels/WorkspaceGitPanel.tsx，以及 docs/decisions/workspace-git-diff.md。此次只做源码研究和文档更新，未修改运行代码，未运行 UI 测试。
