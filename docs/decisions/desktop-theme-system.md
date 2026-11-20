# 桌面外观与主题系统

Archer 的外观由三个可自由组合的维度组成：明暗模式、界面主题与强调色。新安装默认深色外观、Graphite 界面主题和 Graphite Iris 强调色；已有有效偏好保持不变。主题经现有解析器和公共组件生效，不新增 UI 框架。

## 设计依据

[Linear 官方说明](https://linear.app/now/behind-the-latest-design-refresh)强调弱化导航、减少图标装饰与分隔线、稳定标题栏操作位置。官方配色趋向较暖的灰色；Archer 的冷调 Iris 是自己的选择，不称为 Linear 原色。[外观偏好](https://linear.app/docs/account-preferences)作为预设与自定义主题机制参考。

[Linear Nuxt Fullstack](https://github.com/ElvinKyungu/linear-nuxt-fullstack)是应用复刻研究候选，README 展示了 Nuxt UI 等依赖。具体源码、固定提交和许可证文件尚未完成核对，不作为已批准复用来源。本方案没有复制第三方代码。

## 自主管理边界

Archer 自行维护组件与主题，不安装完整第三方 UI 库，不将复刻应用作为运行依赖。允许研究源码；复用前核对固定提交、具体文件、许可证及声明要求。没有明确许可时仅研究思路。

## 三个正交维度

- 外观模式：`light`、`dark`、`system`。`system` 按操作系统明暗解析为最终明暗，不新增第三种调色板。
- 界面主题：`graphite`、`midnight`、`slate`、`warm`。只覆盖中性层——窗口、侧栏、阅读面、表面、文字、边界与代码底，不声明任何强调色。
- 强调色：`graphite-iris`、`slate-teal`、`carbon-amber`、`dusty-rose` 四套预设，另有 `custom`。只覆盖强调色 Token，不替换中性背景。

解析结果是根节点上的三个属性：`data-appearance` 表示最终明暗，`data-base-theme` 表示界面主题，`data-theme` 表示强调色。字号仍由独立的 `data-font-size` 表达，四者互不覆盖。任意界面主题都能与任意强调色、任意明暗组合，样式优先级由双属性选择器固定，而不是靠追加覆盖规则。

## 中性色板

Graphite 是默认界面主题，也是 `:root` 的中性基线。浅色与深色独立定义，不通过反转色值生成。

| 语义 Token | 浅色 | 深色 |
| --- | --- | --- |
| `--bg-app` | #F4F5F8 | #0E1015 |
| `--bg-sidebar` | #F1F2F6 | #12141A |
| `--bg-content` | #FFFFFF | #191C23 |
| `--surface` | #F7F8FB | #222630 |
| `--surface-subtle` | #F2F4F8 | #1E222B |
| `--surface-raised` | #FFFFFF | #292E39 |
| `--surface-hover` | #EAEDF4 | #292E39 |
| `--surface-active` | #E1E5EF | #313744 |
| `--surface-selected` | #E9ECF3 | #2A2F3D |
| `--surface-overlay` | #FFFFFF | #262B36 |
| `--surface-bubble` | #EEF1F8 | #232833 |
| `--border-default` | #E3E6EE | #303540 |
| `--border-subtle` | #EDEFF5 | #272C36 |
| `--border-strong` | #D3D8E3 | #3C4250 |
| `--text-primary` | #232736 | #E9ECF3 |
| `--text-secondary` | #525C6B | #A8B0C0 |
| `--text-muted` | #636D7C | #8F96A5 |
| `--text-disabled` | #9AA2AF | #6A7382 |
| `--code-background` | #F6F7FA | #1D2129 |
| `--code-text` | #2B3040 | #D7DCE8 |
| `--code-border` | #E3E6EE | #2A303B |

其余三套界面主题复用同一组语义名，只替换色值；结构刻度、圆角、间距和字号完全不变。

| 界面主题 | 浅色窗口 / 侧栏 / 阅读面 | 浅色表面 / 边界 | 深色窗口 / 侧栏 / 阅读面 | 深色表面 / 边界 |
| --- | --- | --- | --- | --- |
| Graphite | #F4F5F8 / #F1F2F6 / #FFFFFF | #F7F8FB / #E3E6EE | #0E1015 / #12141A / #191C23 | #222630 / #303540 |
| Midnight | #ECEEF3 / #E7EAF0 / #FFFFFF | #F5F6FA / #DCE0E9 | #07080B / #0A0C10 / #101318 | #181C23 / #272D37 |
| Slate | #EDF1F7 / #E7EDF5 / #FFFFFF | #F4F7FB / #DBE2ED | #0C111A / #101722 / #141C28 | #1D2735 / #2B394B |
| Warm | #F7F4EF / #F2EEE7 / #FFFDF9 | #FAF7F2 / #E6DED3 | #100E0B / #15120E / #1A1712 | #241F19 / #362F26 |

浅色辅助文字使用比参考稿更深的灰阶，保证在白色阅读面与冷灰侧栏上都达到 4.5:1；深色辅助文字同理。四套主题的浅色侧栏最深为 Midnight `#E7EAF0`，深色表面最亮为 Slate `#1D2735`，这两个值也是自定义强调色推导的对比度基准。阴影、焦点环与叠加层按明暗分别定义，菜单、浮层和对话框共享同一套阴影语义。

## 强调色预设

每个预设分别定义填充色、文字色与前景色：填充色用于主按钮和选中标记；文字色用于强调文本；前景色用于填充色之上的文字与图标。浅色与深色各自选择，保证对比度而不是机械反色。

| 主题 | 浅色填充 | 浅色文字 | 浅色前景 | 深色填充 | 深色文字 | 深色前景 |
| --- | --- | --- | --- | --- | --- | --- |
| Graphite Iris | #6066D8 | #565CD2 | #FFFFFF | #8793F6 | #A6AFFF | #101218 |
| Slate Teal | #128078 | #0D746D | #FFFFFF | #52BAAD | #6FD0C3 | #101218 |
| Carbon Amber | #C17D35 | #8A5F35 | #241505 | #E3A15D | #F0B571 | #101218 |
| Dusty Rose | #B24E71 | #A03A5D | #FFFFFF | #E28AA5 | #F0A6BE | #101218 |

Slate Teal 浅色填充取 #128078 而非更亮的青绿，使白色文字达到约 4.8:1；Carbon Amber 的 #C17D35 不足以作为浅色正文，因此强调文本单独使用 #8A5F35，填充上的文字使用深棕前景。文字色与填充色分离后，强调文本、主按钮和选中标记可以同时满足对比度，不必为了可读性牺牲品牌色。

### 自定义强调色

`custom` 接受 `#RGB` 或 `#RRGGBB`，统一规范为六位大写。运行时从用户色值推导三个角色：

- 文字色：保持色相不变，向黑（浅色外观）或白（深色外观）逐步混合，直到对基准中性表面达到 4.5:1。
- 前景色：比较白色与 `#101218` 两种候选，取对填充色对比更高的一种。
- 填充色：若前景与填充不足 4.5:1，继续混合填充色，直到两者都可读。

推导只写入根节点的四个内联变量：`--accent-custom`、`--accent-default`、`--accent-text`、`--accent-foreground`。中性 Token 不参与覆盖，因此自定义强调色与任意界面主题、任意明暗组合都不会破坏背景、文字或边界。

## Token 分层与派生

界面主题块只声明中性 Token，且只覆盖主题相关的部分；未声明的值继续继承 Graphite。强调色主题块只声明 `--accent-default`、`--accent-text`、`--accent-foreground`。其余强调色 Token 由统一公式派生：

- `--accent-hover`、`--accent-pressed`、`--accent-strong`：填充色的悬停、按下与强强调层级，用于主按钮和当前操作。
- `--accent-subtle`、`--accent-subtle-hover`：低比例混合的浅强调表面，用于选中页签、当前计划步骤与选中条目；悬停时加深一档。导航中的会话选中使用中性 `--surface-selected`，不占用强调表面。
- `--accent-border`、`--accent-focus`、`--accent-focus-ring`、`--focus-ring`：强调边界、焦点色与统一焦点环。
- `--accent-muted`：向正文色混合的次级强调，用于当前项目的文件夹图标、进行中步骤图标和轻量入口。
- `--state-focus`、`--state-disabled`、`--state-pressed`：交互状态只引用语义 Token。
- `--control-surface`、`--control-surface-hover`、`--control-border`：普通按钮、字段与选择器的静止与悬停表面、边界，按低比例把 `--accent-default` 混入中性层；正文与图标仍使用 `--text-primary`，因此未交互的控件也能读出当前强调色，同时不进入选中或主操作层级。

浅强调表面上的文字使用 `--text-primary`，强调色只承担背景、左侧标记、边界和图标。`accent-text` 在浅色主题的 14% 混合表面上约为 4.2–4.5:1，若同时用于正文会低于 4.5:1；因此选中项文字保持正文色，`--accent-text` 只用于中性表面上的强调文字。

执行状态中，运行中与当前活动使用强调色；等待授权、成功与失败分别映射 warning、success、danger，切换强调色不改变这三类语义。状态表面与边界由状态色低比例混合生成，保证成功、失败、警告与暂停在任意外观组合下仍有稳定区分；不再使用与强调色无关的固定蓝色。

现有组件继续使用 `--canvas`、`--panel`、`--sidebar`、`--subtle`、`--hover`、`--border`、`--text`、`--secondary`、`--muted`、`--accent`、`--on-accent`、`--selection`、`--bubble`、`--code`、`--shadow` 等别名；别名在 Token 层一次性映射到上述规范变量，业务组件不需要改写。危险实心按钮使用独立的 `--on-danger`，开关滑块使用 `--control-thumb`，避免借用强调色前景。

## 主题应用与恢复

颜色唯一入口为 `ui/theme/design-tokens.css`，主题解析属于 `ui/theme/theme.ts`，本机偏好属于 `store/preferences.ts`。

- `applyTheme` 是唯一主题写入点：解析系统明暗后写入根节点三个属性，并从界面主题定义读取根背景色，覆盖透明窗口与滚动回弹区域。`App.tsx` 在布局阶段调用，`useSystemDark` 通过 `useSyncExternalStore` 订阅 `prefers-color-scheme`，使 System 模式即时响应操作系统切换。
- `index.html` 在样式加载前同步读取 `archer-preferences`，执行同一解析并写入相同属性与内联背景，避免首帧闪白；React 挂载后由 `applyTheme` 接管。启动脚本只做同一解析的同步副本，不维护第二套主题规则。
- 原生标题栏与 Windows 标题栏按钮从当前 Token 计算颜色，经 `window.archerDesktop.setTheme` 传回主进程；主进程只接受两个不透明色值，并同步 `nativeTheme.themeSource`。
- 偏好持久化键为 `archer-preferences`。恢复时只接受四套界面主题、四套预设加 `custom` 的合法标识，并校验自定义色值；未知值回退深色、Graphite、Graphite Iris，字号保持独立字段。

## 原生控件的自绘边界

表单控件不再交给操作系统绘制外观。`foundation.css` 对 `select` 统一启用 Chromium 可定制下拉（`appearance: base-select`），按钮边界沿用所在上下文的输入、设置行或检查器刻度，展开列表使用 `--surface-floating`、`--border-soft`、`--radius-panel` 与 `--shadow-popover`，与公共菜单同一浮层语义。

- 选中项文字：原生 `select` 的默认按钮无法在固定宽度内省略长文本，全部下拉改为 [`ui/primitives/Select.tsx`](../../apps/desktop/renderer/src/ui/primitives/Select.tsx) 提供的作者内容模型（`button` + `selectedcontent`），选中文本单行省略，展开列表的选中行使用 `--accent-subtle` 表面、`--accent-text` 勾选标记。
- 选项状态：悬停与键盘焦点使用 `--hover`，选中使用浅强调表面，禁用使用 `--state-disabled`，分组标题使用 `--muted` 与辅助字号。选项只在浮层内绘制，规则直接声明为 `option` 与 `optgroup`，不以 `::picker(select)` 作祖先。
- 输入区选择器已有自绘箭头，隐藏 base-select 的 `::picker-icon`，避免出现两个箭头。
- 复选框、单选框与滑块的系统强调色通过 `accent-color: var(--accent)` 跟随 Accent Token；文件选择按钮用 `::file-selector-button` 覆盖为公共按钮表面；数字输入的步进按钮无法取色，直接隐藏，保留键盘与滚轮调整。

仍由系统绘制的表面无法读取界面主题与强调色：macOS 菜单栏、原生右键菜单、系统取色器与标题栏框架。标题栏只通过 `nativeTheme.themeSource` 跟随明暗，其余三者保持操作系统外观；应用内菜单、下拉浮层、Dialog 与输入控件全部由 Token 绘制。

## 外观设置中心

设置中的「外观与主题」是独立页面，沿用设置工作区的分类导航、返回应用、固定页头与滚动正文，不新开窗口。页面自上而下包含：

- 外观模式：行内分段选择（浅色、深色、跟随系统）。跟随系统时在说明中标注当前实际明暗，不修改字号或主题。
- 界面主题：四个单列选择卡，每张卡显示窗口、阅读面、边界三层缩略色块、名称和中文说明，选中时显示勾选。色块直接取该主题在当前明暗下的真实值，强调色块取当前强调色填充。
- 强调色：预设行由色点、名称、中文说明、当前明暗十六进制值和选中勾选组成。Custom 行打开十六进制输入与系统取色器；输入完整合法色值时即时应用，非法输入保留草稿并提示，不写入偏好。
- 文字大小与对话排版：沿用分段选择与设置行，不随主题或强调色改变。
- 恢复默认外观：显示目标组合「深色 · Graphite · Graphite Iris」，一次恢复三个维度与自定义色值。

页面底部是可折叠的「主页实时预览」。预览使用真实的导航、Agent 卡片、主次按钮、选中条目、输入框和成功/等待/失败状态标签，全部读取当前语义 Token，不写死颜色；组合标题显示当前界面主题与强调色。预览不接收交互，仅用于同视口判断整体协调性。

选择立即生效并持久化，不需要重启；切换强调色不改变任何中性 Token，切换界面主题不改变强调色，切换明暗不改变布局、字号、品牌图形或执行状态语义。

## 主页中的强调色层级

强调色是应用级视觉识别，不只存在于设置预览。正式主页按三档强度消费 Token，页面结构和信息层级保持不变：

- 强强调：主按钮与发送按钮的填充、当前页签文字与下划线、当前会话与项目的左侧标记、输入区焦点边界与焦点环。
- 浅强调：当前会话、选中页签悬停、活动记录选中、当前计划步骤、文件树选中行、运行中状态标签与分段选择的选中项。
- 低强调控件：普通按钮、输入框、下拉控件与仅图标动作在静止状态使用 `--control-surface` / `--control-border`，悬停使用 `--control-surface-hover`；强调色只进入表面与边界，文字保持 `--text-primary`。
- 中性：普通消息、阅读背景、分隔线与列表行仍保持中性层；选中表面上的正文使用 `--text-primary`。

导航悬停、应用轨道选中图标、执行阶段图标、当前会话运行色点与简版运行状态使用强调色；成功、失败、警告、暂停与等待授权仍使用各自的语义色。该层级由 `tests/desktop/renderer/accent-usage.test.ts` 检查正式主页样式是否实际引用 Accent Token，防止主题只更新变量而组件不消费。

## 布局与验收

主题不改变布局、结构刻度、品牌图形、Contract、事件事实、授权或 Runtime 执行规则。字号、间距、圆角、控件高度和内容宽度集中在同一 Token 文件，新增界面主题只能增加中性 Token 块与 `BASE_THEMES` 定义，新增强调色只能增加 `COLOR_THEMES` 定义与对应 Token 块。

自动验证读取真实 CSS 色值，覆盖四套界面主题 × 四套预设 × 两种明暗的正文、辅助文字、强调文本、按钮前景、代码与危险按钮 4.5:1 对比度，并用多组极端自定义色值跨全部主题验证推导结果；同时验证切换强调色不改变中性 Token、切换界面主题不改变强调色、强调色块只声明强调色变量、界面主题块不声明强调色。`accent-usage.test.ts` 另外检查正式主页的当前项目提示、当前活动、输入焦点、发送按钮与中间页签确实引用 Accent Token，确认会话选中保持中性表面，并确认成功、失败、警告与暂停没有被强调色覆盖。原生控件的自绘外观在渲染层用浅色 Graphite、深色 Midnight 等组合检查下拉浮层、选中行、省略长文本、文件按钮与勾选强调色；控件强调色覆盖再检查浅色 Graphite + Graphite Iris、浅色 Graphite + 自定义 `#AFB4E4`、深色 Graphite + Carbon Amber 三组组合，确认普通按钮、字段、下拉触发器与分段选择在静止状态即显示当前强调色，主按钮与危险按钮仍保持各自实心层级。macOS 菜单栏、原生右键菜单与标题栏不属于可主题化范围，实际 Electron 窗口的键盘焦点、窄宽度下拉和四种工作状态仍需人工验收。

## 固定的结构与交互规则

颜色唯一入口为 design-tokens.css；主题解析属于 ui/theme/theme.ts；本机偏好属于 store/preferences.ts。布局、基础控件、导航、工作区、检查器和设置按职责维护现有模块，不为目录形式复制组件。公共按钮和浮层继续由 Surface.tsx / surfaces.css 管理。

窗口框架使用 `--bg-app`，导航使用 `--bg-sidebar`，阅读区使用 `--bg-content`，普通按钮、输入、下拉与分段选择使用 `--control-surface` / `--control-border` 及其悬停态，列表行与只读表面使用 `--surface` / `--surface-subtle`，浮层使用 `--surface-overlay`。禁止在业务中硬编码主题色值。可点击控件一律经由 Surface.tsx / surfaces.css 的共享规则取色，不出现未套用控件的裸按钮。焦点沿用统一 `--focus-ring`，禁用沿用 `--state-disabled`，按下状态引用 `--state-pressed`。错误、警告、成功与 Diff 保留独立语义。

## 应用框架参考与自主实现

实际阅读来源为 [Circle globals.css](https://github.com/ln-dev7/circle/blob/master/app/globals.css)、[Circle LICENSE.md](https://github.com/ln-dev7/circle/blob/master/LICENSE.md) 与 [linear-ui tokens.css](https://github.com/guillermobeltramino/linear-ui/blob/main/src/styles/tokens.css)。Circle 的许可文件为 MIT；linear-ui 的代码许可未核实，不复制其代码。本轮仅学习语义分层与尺度组织，未引入项目依赖或粘贴实现。GitHub API 限流，未取得固定提交；这些分支链接是研究定位，不构成可复用代码的版本凭据。

Archer 的实现选择：236px 目录栏、44px 应用轨道及标题栏、30px 导航行、16px 常规图标、12px 输入圆角、10px 阅读工作区圆角。保持原有文字字号和内容宽度，页签压缩为 32px、取消重复底部分割线，输入使用独立辅助表面和清晰边界。品牌标题为 Archer；工作区目录仍属于导航。数据、授权及任务状态不因视觉变化而变更。

## 验证

`tests/desktop/renderer/theme.test.ts` 读取真实 Token 文件，覆盖预设与界面主题集合、默认组合、系统明暗解析、根节点写入、偏好恢复与未知值回退、自定义色值规范化与对比度推导、四套主题两种明暗的对比度、缩略色与真实中性 Token 一致、强调色与中性层互不影响，以及强调色块不声明结构刻度。`tests/desktop/renderer/accent-usage.test.ts` 验证正式主页组件实际消费强调色层级与语义状态色。`tests/desktop/renderer/settings-workspace.test.ts` 验证外观页的界面主题分组、九个单选入口、主页实时预览与恢复默认结构。控件强调色检查覆盖共享按钮、设置与弹窗字段、菜单悬停、分段选择、检查器选择器与四个曾使用裸 `<button>` 的入口（提供者浏览重试、技能重试、异常记录重试、设置返回应用），确认它们全部读取 `--control-*` 或公共按钮类。仓库类型检查与 Lint 通过；实际 Electron 窗口的菜单、焦点、长内容和四种工作状态仍需人工验收。
