# 官方样式对照样板

此目录仅用于 Component Explorer 的 `#/reference` 页面，不导出为 `@archer/ui`，不接入正式对话、Agent 或权限流程。

## 来源与本地改动

固定来源：shadcn-ui/ui，revision `e62c9435fff729a175f38983dee73b2cb4f6a069`。选择 Rhea 样式及 Neutral 明暗配色，不声称还原官网全部展示页面。

`upstream/*.tsx` 复制自 `apps/v4/registry/bases/base/ui/` 的同名文件。保留官方组件结构、类名、Props 与 Base UI 交互；仅调整本地 import、图标入口、中文注释与格式。`provenance.json` 记录原始路径和修改前文件 SHA-256，MIT 许可全文在 `LICENSE-shadcn-ui.txt`。

`upstream/rhea.css` 从 `apps/v4/registry/styles/style-rhea.css` 提取已使用组件的 103 条规则，规则内容不变。`upstream/neutral.css` 来自官方 Neutral 的 `inlineColors.light/dark` 色值。图标入口统一映射到 Phosphor regular。

`Specimen.tsx` 是 Archer 自行编写的固定交互样例，两侧共用一份；Tool 和 Plan 是官方 Trace 的组合，不伪称复制了独立 Tool/Plan 实现。样例未执行真实命令。Code Block 展示的是官方基础增删行能力，不提供语法高亮服务。

## 样式边界

两个 iframe 加载相同入口、组件、配套 CSS 和数据。左侧使用 Neutral；右侧通过 `tokens.ts` 映射当前 Archer 的语义颜色和字体，不映射字号、行高、圆角或间距。官方 `accent` 表示普通悬停色，对应 Archer `surface-hover`，品牌色映射到 `primary`。

独立文档不导入 Desktop 的 foundation、surfaces 或其他业务 CSS，避免全局 button/input 选择器改变官方造型。配置消息限制同源和父窗口来源，只允许颜色与字体字段；它不是新的运行时或 Agent 事件协议。

顶部状态同时更新两侧；局部输入、折叠、弹窗各自独立。外观控制仅影响预览文档，不持久化业务设置。小于 1000px 时对照列上下排列。入口当前用于 Vite 开发预览，不包含在正式桌面生产构建入口中。

## 验证

运行 Desktop Vite 预览后打开 `/agent-ui.html#/reference`。检查明暗、强调色、运行/完成/失败状态，输入与选择、弹窗焦点及 Escape、Popover、Trace 折叠和复制。两侧在相同容器宽度下应保持相同结构尺寸；字体变化可能改变文本换行。自动检查：`pnpm exec vitest run tests/ai-ui`、Desktop typecheck 和 ESLint。

界面主题、强调色和明暗三个维度分别选择，来源说明直接链接固定 revision 的每个上游文件。完成态额外展示公开最终答复。工具失败样例中的未完成计划保持未完成声明，不由工具状态推断计划失败。编辑弹窗维护临时草稿，取消丢弃、保存应用，作用范围仅限本地样例。
