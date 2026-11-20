# Agent UI 组件浏览与演示边界

Archer 采用 shadcn/ui 源码和 AI Elements 组合模式作为 UI 基础，按需改编并在 `@archer/ui` 本地维护。来源与许可证见 `packages/ui/THIRD_PARTY.md`。所有组件消费当前全局 Design Tokens 和 Phosphor，不引入 AI SDK、第三方 UI Runtime 或平行主题状态。

独立目录及页面规范见 [Component Explorer](../guides/ui-component-explorer.md)。开发服务器入口为 `/agent-ui.html`，源文件位于 `apps/desktop/renderer/src/ui/ai-ui/playground`。入口不替换正式页面，也不作为生产路由承诺。演示不连接服务、不执行工具、不授予权限，不将固定内容写入正式会话。

## 场景

- 基础组件：Button、Input、Card、Dialog、Popover 的正常、禁用和错误状态。
- 文件与代码：文件夹展开、文件选择、增删行、行号、折行和复制。使用固定片段，不执行磁盘读取或差异计算。
- 只读内容：来源列表、行内引用、快捷建议、堆栈帧与测试结果。使用固定数据，不抓取链接、不解析真实堆栈、不执行测试、不提交建议。
- 侧栏与设置：Sidebar 和 Field 组合，外观模式、中性主题、强调色、单选控件与地址错误。选择只作用于当前文档或内存，不保存应用配置。
- 无计划执行：公开反馈与工具活动，不生成计划或阶段。
- 运行中：展开声明步骤，当前步骤使用 Accent。
- 已完成：计划默认折叠，声明步骤完成色使用 success，最终答复独立。
- 人工确认：待回答卡片与原位折叠历史，演示回答只改变内存。
- 工具失败：同一 Trace 行语法下展示局部错误，汇总继续区分任务状态与问题。
- 长历史 / 多计划：历史计划和连续活动各自折叠，保留独立阅读滚动。

## 交互与验收

Tool、Plan 与 ActivityGroup 共用 Trace 的图标、标题、说明和折叠结构。用户展开选择由原语保持；父组收起再展开后，保留挂载的子项仍维持之前的展开状态。当前人工交互位于活动之外；回答后只显示一行历史入口，完整问题和答案仍可查。

长历史由 ConversationViewport 管理阅读位置，输入区固定；窄窗口将场景导航移到顶部，文件和设置布局纵向排列。演示不证明流式事件顺序、恢复或真实授权已经接通，真实事件接入须单独验证。

验证执行 `pnpm --filter @archer/ui build`、`pnpm --filter @archer/desktop typecheck`、`pnpm exec vitest run tests/ai-ui` 与相关 Lint。浏览器核对折叠、键盘、复制、文件选择、设置错误、来源展开与无效协议、建议回调、堆栈展开、测试结果状态及明暗显示，并比较桌面与窄窗口截图。Electron、全部主题组合及正式页面接入不能由演示验收替代。
