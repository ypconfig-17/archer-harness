# 架构总览

Archer Harness 使用 Camp 管理 Provider，以 Contract 描述接口，以 Effect 表达 Agent 的执行意图。Kernel 只承担 Generator 与 Handler 之间的控制权交接。

```text
入口（CLI / HTTP / Desktop）
  Archer ── ArcherContext（应用依赖）
    Agent（持续会话）
      Turn → 纯决策 → 事件草稿与命令
        Runtime → 提交意图 → Effect 管线 → 提交结果
          Camp → Provider 的类型化 Contract 接口
```

## 设计价值与验证边界

可追溯执行是这套分层的主要目标：执行意图与开始事实必须先提交，结果、失败或未知状态随后进入事实。调用超时、取消或断连时保留不确定性，让恢复依据证据推进，避免把未确认的副作用当作未发生。已确认成功的操作不因重启再次执行；未知写入需要人工对账，不承诺任意外部操作 exactly-once。

最小 Kernel 保护控制权交接与领域执行规则之间的边界。它只处理 Generator 的 yield / next / throw，不认识 Effect、Agent、日志、授权或恢复。Runtime 与 Handler 承担提交和执行规则，Camp 承担能力解析与资源生命周期。复杂性有明确归属，不能用 Kernel 代码少来推导整个系统简单。

类型化能力使 Provider 接入通常无需修改 Kernel；这种扩展仍受当前 Contract 与已支持 Effect 的约束，不意味着任意协议或动态安装已经可用。Agent 的纯决策只依赖事实、输入与显式上下文，时间和领域标识不从环境隐式获取；模型和 Provider 输出作为外部输入固定后，可以验证决策确定性，不要求模型本身确定。

可检查性延伸到已提交的模型请求快照、工具结果、用量与上下文整理事实。界面读取这些事实，不以临时流式预览替代最终结果。摘要保留原始历史，但机械来源校验不能证明摘要语义无损。

验证围绕对外行为与不变量：tests/archer/recovery.test.ts 检查重启与已成功操作复用，tests/archer/fs-write-recovery.test.ts 检查真实文件写入的未知结果，tests/agent/replay.test.ts 检查状态回放，tests/desktop/renderer/context-panel.test.ts 检查上下文事实投影。运行 `pnpm test --maxWorkers=2` 可执行工程回归；它不证明真实模型任务成功率，也不构成与其他框架的性能、Token 消耗或可靠性比较。

## 职责

| 组件 | 负责 | 边界 |
| --- | --- | --- |
| Camp | Provider 声明、稳定引用、契约解析与资源生命周期 | 不识别 Agent、Turn、Effect 或模型策略 |
| Provider | 实现一个或多个能力，每个能力声明一个 Contract | 不管理 Agent 日志或调度 |
| Contract | 元数据校验、接口方法与版本标识 | 函数只存在于进程内 |
| Archer | 应用生命周期、基础设施选择、Agent 管理 | 借用或拥有 Camp，不复制能力注册机制 |
| ArcherContext | 类型化应用服务解析和自己拥有的资源释放 | 基础设施从 Camp 获取，不选择模型工具或技能 |
| Agent | 会话折叠、输入队列、Turn 投影与纯决策 | 不执行 I/O、不读取时钟或随机数 |
| Runtime | 唯一串行提交边界、Effect 执行、审批和恢复 | 从 Camp 解析固定目标，不猜测副作用结果 |
| Handler | 固定执行包装、授权校验与能力调用结果归类 | 依赖宿主提交端口，不拥有会话、存储或恢复 |
| Kernel | Generator yield / next / throw | 无领域知识和包依赖 |

## 执行不变量

1. 相同事实、输入与显式上下文产生相同的纯决策。模型与 Provider 输出是外部输入。
2. 只有执行意图和开始事实提交成功后，才能调用能力。通知只能引用已提交事实。
3. 取消请求、超时和断连不证明外部写入未发生。未知写入保留待人工对账，不自动重试。
4. 事件是持久化状态的唯一事实源；决策和回放共用折叠规则。恢复不重放已成功副作用。
5. 每个 Agent 最多一个活跃 Turn，每个 Turn 最多一个在途 Effect。锁、Generator、句柄和租约只属于进程。
6. 已提交调用携带 Provider ID、能力 ID、Contract ID 和来源修订；恢复必须解析同一引用。

## 当前范围

每个 Archer 使用 Camp 中共同的 Tool 与 Skill 集合。没有按 Agent 筛选能力的配置。宿主通过 Provider 组成控制可用能力；文件访问范围和 Shell 的单次授权仍由执行边界落实。

Runtime 执行 INFER 和 CALL；人工等待沿用现有事实与命令。SPAWN、COMPACT、ABORT 等协议声明不代表末端 Handler 已实现。tokenBudget 在已提交累计用量达到预算后阻止后续推理，缺少用量时明确失败；支持窗口测量的推理能力由 Handler 做完整请求估算准入与有界摘要；估算不构成精确 token 或费用硬保证。

Provider 在 Camp 初始化时固定，不提供运行中装载代码、安装包或增删 Provider 的远程入口。需要新组成时由宿主创建 Camp。持久化使用 JSONL，全量回放，不引入数据库投影或 Generator 栈恢复。

## 依赖

```text
kernel → 无工作区依赖
contracts → zod
agent → contracts
camp → contracts
providers / memory / storage → camp / contracts
handler → agent / contracts
runtime → handler / agent / kernel / camp / providers / contracts
inference-pi → contracts
client → contracts
apps → 按入口职责组合上述包
```

模型只收到系统规则、工作环境、会话消息和标准 Function Calling 声明。内部能力引用不会拼进消息或发送给模型服务。
