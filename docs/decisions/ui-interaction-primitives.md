# 公共交互原语

## 职责

公共 Tabs、Switch、SegmentedControl、Dialog 和 Popover 组合 Base UI 原语。
Archer 保留视觉 Token 与业务接口，键盘导航、焦点约束、焦点归还、浮层定位和外部关闭交给原语。
不引入新的 UI 状态管理器，不改变 Agent 事实、授权、执行或恢复。

Tabs 的面板仍由调用方使用 hidden 保持挂载，切换不丢失输入与阅读位置。
SegmentedControl 使用单选 ToggleGroup，忽略取消唯一选中项的请求，保证偏好始终有值。
Switch 是受控组件，只请求宿主更新值。

Dialog 使用 Portal、Backdrop 与 Popup。默认拒绝遮罩关闭；closeDisabled 同时约束 Escape、外部点击与标题关闭。
初始焦点可显式指定，关闭后的焦点归还由 Base UI 维护。
Popover 始终使用 Portal，Positioner 统一避碰，业务不计算坐标或监听窗口尺寸。
关闭的 Portal 内容不出现在服务端静态标记中。

## 验证

`pnpm exec vitest run tests/ai-ui` 验证受控值、互斥选择、面板关联和提交中关闭限制。
`pnpm --filter @archer/ui build` 与 `pnpm --filter @archer/desktop typecheck` 检查公共接口及页面调用。
实际窗口需检查明暗主题、嵌套弹窗、焦点归还、窄窗口避碰及页签切换后的阅读位置。

## 页面组合与只读详情

人工询问的选项使用公共 RadioGroup，取消选项通过独立「清除选择」动作表达，
不再让已选单选按钮承担反向切换；清除后仍可填写自定义回答。
未知结果的核查确认使用公共 Checkbox，确认只改变界面输入，不提交重试或推断外部操作结果。

上下文原始声明、人工操作说明、Sources、StackTrace 和 TestResults 使用公共 Collapsible。
只读展示组件的展开按钮不产生执行意图；明细 keepMounted 保留原始内容及已有阅读状态，关闭时由原语隐藏。
组件目录的 Preview / Code / Usage / Source 复用公共 Tabs，不维护第二套方向键规则。

CodeBlock 家族示例展示官方组合 API，CodeSnippet 单独展示带路径与变更行的业务组合；
每个公开导出都有独立条目，家族内共享同一份可运行示例。

`tests/desktop/renderer/pending-controls.test.ts` 验证单选互斥、显式清除及核查确认对重试按钮的约束，
测试中的服务为空端口，选择或勾选本身不能触发服务调用。
`tests/ai-ui/primitive-interactions.test.ts` 验证来源折叠的可见性与原始链接保留。

## 活动、时间线与 AI 展示

活动页的任务批次、交互、原始 JSON，以及时间线的较早活动、原始请求、
InteractionRecord 和 RecordDisclosure 都使用公共 Collapsible。
折叠只改变可见性，keepMounted 保留已加载事实与明细内容；未知结果、授权记录和错误仍保持各自语义。
活动页初次打开时展开最新任务，关注类筛选默认展开交互；同一筛选内保留手动展开状态，
切换筛选按新筛选重新初始化，不因后台追加事件强制覆盖用户选择。

活动记录、工作台入口、上下文条带、图片重试、目录入口、TraceAction 与附件移除使用公共 Button。
Item 的 render 原生 button 是官方组合接口，不额外再包一层按钮。
InlineCitation 复用 Tooltip，链接仍仅接受 http(s)，不抓取内容，不推断来源可信性。

Tool、Reasoning、Task、Terminal 和 Plan 继续组合官方 Trace / Collapsible，
Message 与 AssistantAnswer 保留领域内容插槽；这些数据投影不是需要替换的第二套交互原语。
ConversationViewport 使用公共 ScrollArea，通过 viewportProps 取得真实视口与滚动事件；
阅读跟随和加载历史时的位置补偿仍由会话展示层负责，不交给滚动条组件。
正式对话页已有的阅读定位与输入调度不因目录展示组件调整而替换。

验证包括活动页独立展开、记录定位、关闭详情归还焦点，以及关闭运行详情时模型和用量隐藏。
执行 `pnpm exec vitest run tests/ai-ui tests/desktop/renderer --maxWorkers=2`、公共 UI 构建与桌面类型检查。
