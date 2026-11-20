# Effect 执行管线

Kernel 只交接控制权；Runtime 固定装配 `withHumanInteraction → withJournal → withAuthorization → withAudit? → Handler`。外层先进入，结果逆序返回。扩展观察回调不能改变结果或替代日志提交。


## 包与依赖边界

`@archer/handler` 依赖 contracts 和 agent，复用 SessionEffectOutcome 与取消结果文案，不反向依赖 Runtime、Camp、Kernel 或具体 Provider。它接收已解析的固定能力和 ExecutionJournal 端口，不拥有会话状态、日志存储、锁、输入队列或恢复调度。Runtime 实现提交端口并维护唯一写入边界，Handler 包只按固定顺序调用这些端口。该拆分保护执行顺序和结果归类的集中性，不增加能力注册机制。

管线类型、组合函数和包装器从 `@archer/handler` 导出；`@archer/runtime` 只导出应用生命周期接口，不转发 Handler API。准备参考提示词集中在 `packages/handler/src/prompt`；上下文选择与窗口策略均集中在 Handler，Agent 提供完整历史意图。

## 职责与调用顺序

`packages/handler/src/execution-pipeline.ts` 是 `@archer/handler` 固定管线的唯一装配入口，Runtime 调用它并提供执行上下文。SessionRuntime 负责从已提交事实选择工作、解析固定能力并提供串行提交端口；Kernel 只转交意图和结果。

| 顺序 | 文件 / 入口 | 作用与短路条件 |
| --- | --- | --- |
| 1 | human-interaction.ts / withHumanInteraction | 合法人工请求提交等待并返回 null，不进入开始提交；其他请求继续 |
| 2 | journal.ts / withJournal | 调用 begin 确认开始，再进入内部；返回后调用 complete 提交非 null 结果；提交异常直接传播 |
| 3 | authorization.ts / withAuthorization | 校验 CALL 来源、交互声明、Shell 授权与输入；拒绝返回 failed，由外层提交；INFER 透传 |
| 4 | audit.ts / withAudit | 可选的进程内执行观测，内部返回后调用回调；回调异常不影响结果 |
| 5 | pipeline.ts / createDispatcher | 按类型分发 INFER 和 CALL；其他类型明确拒绝 |
| 6 | inference-pipeline.ts / executeInference 或 call.ts / call | INFER 编排上下文、预算与受控模型请求；CALL 直接执行能力并归类结果 |

正常 INFER 的调用顺序为：开始确认 → 授权透传 → 用量准入 → 准备参考 → 构造原文上下文 → 按 Profile 策略链评估窗口与整理步骤 → 必要摘要及采用提交 → 窗口复检 → 实际请求提交 → Inference.infer → 响应提交 → 观测回调 → 外层结果提交。准备参考由 inference-preparation.ts 执行，只处理已固定的 preparations，限制大小并插入固定前缀之后，不重新读取会话历史。取消检查包围准备和模型调用。

`inference-pipeline.ts` 集中维护预算和真实请求的提交执行顺序；内部 `context-management.ts` 负责投影、策略循环、摘要复用与采用，不另建提交端口。缺失已提交 Profile 时明确拒绝。无可用摘要或无收益结果只阻塞当前步骤，后续步骤仍可补救；提交异常、预算拒绝和计量变化直接中止。

正常 CALL 的调用顺序为：开始确认 → 授权校验 → Tool.invoke 或适配后的 Skill.load → 结果校验与归类 → 观测回调 → 结果提交。outcome.ts 仅复用错误、取消和未知结果的归类规则。

观测回调发生在结果提交之前，不能视为已提交事件通知；授权拒绝不会进入观测包装。订阅通知由 SessionRuntime 在提交确认后发出。返回 null 时不提交完成结果：人工路径保留等待，停止路径保留未收束的开始事实。包装器不自行恢复或重试。

## 上下文与用量的归属

Agent 固定完整历史意图，Handler 包统一负责 Context、Preparation、ContextWindow、Compaction、Usage 和 Infer 阶段。每个实际模型请求先经 Runtime 提交 inference.requested，返回后提交 inference.responded；摘要校验后追加 context.compacted，随后才能用于普通请求。摘要与普通请求共用预算，外层结果不重复计数。实际输入与估算方法保留在请求及响应事实中，桌面上下文面板和用量投影据此展示。

完整的 11 项职责、顺序、核心算法、收益和限制见 [Handler 设计](handlers.md)。

withHumanInteraction 把人工交互和命令审批转换成已提交等待。授权凭证只绑定指定 Agent、Turn 和 Effect，重签或消费后失效，明文不进入日志。拒绝不能作为能力执行授权。

withJournal 通过 SessionRuntime 的唯一提交端口提交开始和结果。begin 失败或因事实已变而返回 false 时不执行。结果提交失败原样传播并隔离会话，不重试外部能力。

withAuthorization 验证固定目标、交互声明、Shell 单次授权和 JSON 输入 Schema。文件工具另外落实工作目录、只读范围和 expectedRevision。Shell 使用宿主进程权限，不提供文件、进程或网络隔离。初始 cwd 必须在工作区内，但不限制命令所引用的路径；命令继承宿主进程的完整环境（包括 HOME），再应用宿主显式配置的环境覆盖值；不会自动加载交互式 Shell 启动配置。环境继承也包括宿主进程中的凭证变量，不能将环境过滤视为安全隔离。模型描述必须区分初始目录、环境、系统权限与审批策略；不能将审批描述为能力提升，也不能将工作区误称为 Shell 沙箱。模型应通过相关只读检查确认访问能力，再报告具体阻碍。

## 末端接口

| Effect | 执行接口 | 结果 |
| --- | --- | --- |
| INFER | 已固定 Inference.infer | 模型内容、工具调用、usage、准备结果 |
| CALL / Tool | 已固定 Tool.invoke | 可序列化 value，可选 modelContent |
| CALL / Skill | 已固定 Skill.load | 正文和可选内容 revision |

Skill 正文最多 64 KiB。CALL 输入先校验；Tool 的 resultView: output 只将显式 output 文本投影给模型，完整结果仍提交日志。该投影允许显式布尔 isError 表示已知的操作失败；Runtime 校验后写入 CALL 结果及模型工具消息。Shell 非零退出使用此标记，进程结果仍为已完成而非副作用未知。没有投影声明时序列化完整 value，不猜测第三方字段。

OperationRejected 表示能力确认拒绝且无不确定副作用，可记录 failed。read 接口异常记 failed；write/shell 进入调用窗口后的异常、无效返回或确认丢失记 unknown。停止流程中无法收束的结果返回 null，保留 started 供恢复判定。

INFER 失败收束为失败；当前没有通用自动退避重试。SPAWN、COMPACT 等没有对应末端 Handler，不能把协议类型视为执行支持。

## 摘要与历史证据

Handler 以 ContextHandoffSchema 和原始消息快照验证交接，Agent 在 context.compacted 回放时复用同一纯校验。Runtime 在执行时从已提交状态捕获有界参考所需的事实与只读历史结果，Handler 构造数据参考并把完整请求交回 Runtime 提交；不会自行读取或写入 Journal。history.read 按普通只读 CALL 执行，端口仅绑定当前 Agent、当前快照的已确认模型正文。详见 [证据边界](../decisions/context-evidence-boundary.md)。
