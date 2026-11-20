# 公开 API

实际导出由各包 src/index.ts 定义。接口完整类型位于 `@archer/contracts`，本文说明组合和完成边界。

## Camp

`createCamp({ providers, signal? })` 异步校验并初始化 Provider，返回 Camp。`provider(id, capabilities, options?)` 构造声明；`offer` 提供自定义 Contract，`tool`、`skill` 提供标准声明。

| 方法 | 行为 |
| --- | --- |
| providers() | 只读、可序列化 Provider 与能力描述快照 |
| list(contract) | 按契约列出固定引用与经过校验的元数据 |
| resolve(ref, contract) | 精确解析同一来源实现，不按名称回退 |
| acquire() | 返回幂等释放函数，用于共享资源借用 |
| close() | 拒绝新使用，等待借用结束，逆序释放资源 |

## Archer

`createArcher({ camp, inference?, journal?, preparations?, clock?, configureContext?, onError?, onEffectExecuted? })` 返回 Archer。start 完成会话加载和恢复；stop 等待实际工作收束，可指定 timeoutMs 限制等待。

`archer.context` 是运行中的应用依赖容器。`archer.camp` 是借用的能力容器。`archer.agents` 提供 create/get/list/remove/rename、configureExecution、resumeQueue/clearQueue、人工回复与 reconcile。

创建 Agent 接受 id、instructions、可选 inference 和显式 workspace。工作目录必须存在且为绝对路径。configureExecution 使用 expectedRevision，workspaceAccess 可改 read/edit，commandAuthorization 必须固定当前 turnId。

## Agent 与 Turn

| API | 完成边界 |
| --- | --- |
| send(input, options?) | 输入接受事实提交，返回 TurnRef |
| prompt(input, options?) | Turn 完成；失败或取消抛错 |
| followUp / steer | 对应输入事实提交，不等待外部操作完成 |
| abort | 取消请求提交，不证明操作已停止 |
| wait(turnId) | 等待指定 Turn 收束 |
| getState / events | 已提交快照与日志 |
| turns.get/list/events/watch | 同一会话日志的 Turn 投影 |

requestId 对相同输入和选项幂等。events 的 afterSeq 为严格大于，beforeSeq 为严格小于，两者不可同时传入。Agent 和 Turn 序号属于不同范围；SSE 游标不能混用。

## HTTP 与 Client

Server 只做适配。GET `/api/providers` 返回 Provider 声明；PUT `/api/agents/:agentId/execution` 提交执行配置。Agent、Turn、输入、人工确认、对账和 SSE 路由见 README。Client 的 providers、configureExecution 和 Agent API 对应这些路由。

Provider 实现和 JavaScript 函数不能通过 HTTP 上传或写入事件。Provider 组成由宿主代码决定。


### 完全访问与当前命令的联合确认

`configureExecution.commandAuthorization` 可包含 `expectedPendingEffectId`：字符串固定等待项，`null` 明确要求当前没有等待项；省略则不增加等待项约束。`approveCommand` 包含 `effectId` 和短期人工 `token`，仅允许与 `allowShell: true`、`commandMode: 'full'` 及相同的 `expectedPendingEffectId` 一起提交。

Runtime 在同一会话锁内校验任务、配置 revision、命令等待项及凭证有效性，使用原有人类回复决策生成恢复事实，与执行配置事实一起提交，提交成功后才派发命令。凭证不进入日志。过期配置、错误凭证或等待项变化均拒绝整个请求。此入口不扩大 Kernel 或 Camp 职责，也不保证外部命令副作用 exactly-once；提交失败或未知仍遵循原有隔离规则。

## 图片与文本输入

`send`、`prompt`、`followUp` 和 `steer` 接受字符串或 `{ content: [...] }`。
内容块为 `{ type: 'text', text }` 和
`{ type: 'image', mediaType, data }`，图片 `data` 是 Base64 原始编码，不带 data URL 前缀。
支持 PNG、JPEG、WebP、GIF；单次输入最多四张，单张编码最多 7,000,000 字符。
HTTP 请求体上限为 30 MiB。图片数据属于会话事实，随 JSONL 持久化；不保存临时文件路径或远程 URL。

Runtime 与纯策略把输入投影为 `Message.content` 和 `Message.images`，初始输入和引导输入遵循相同规则。
pi-ai 将图片转换为原生视觉内容块；模型未声明图片输入能力时明确拒绝。
Camp、Kernel 的职责和提交、恢复顺序不变。恢复读取已提交图片，不重新读取剪贴板。
图片 Base64 不按文本 token 估算，每张图片预留 16,384 token；该估算不是精确用量或窗口保证。
摘要请求将图片作为视觉内容传入，文本描述只包含图片类型，避免把编码当作正文。

桌面新对话及现有会话支持粘贴图片、预览、移除和纯图片发送；不提供文件选择入口或输入占位文案。
桌面单张文件最多 5 MiB，异步读取完成后才能发送；未确认提交保留原始图片快照用于幂等重试。
普通及大段文本使用原生粘贴，不截断、自动发送或覆盖选择区之外的草稿。
草稿只保留在页面进程内；已提交图片可在历史消息中查看。

验证：`pnpm test` 覆盖图片协议校验、序列化投影、长文本完整性与模型能力拒绝；
`pnpm typecheck` 和 `pnpm lint` 检查跨模块类型与代码规范。
