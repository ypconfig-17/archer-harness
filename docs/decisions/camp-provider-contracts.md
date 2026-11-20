# 独立能力容器与类型化契约

## 问题

工具、技能、推理和日志具有不同的接口与生命周期。把所有能力都解释为目录树中的单次操作，会将定位、发现、调用与模型策略耦合，也难以自然表达基础设施的持续服务。

## 决策

Camp 独立管理 Provider、声明、来源引用和资源。每个能力使用明确的 Contract；接口保留 invoke、load、infer 或 Journal 方法。Runtime 选择模型工具和技能，并将 Agent 外部操作固定到 Effect 事实。Context 从 Camp 解析基础设施，不参与模型能力策略。

能力身份区分 Provider ID、本地能力 ID、Contract 版本和来源 revision。模型工具名只是本次投影，不能用于恢复。同名实现来源变化不允许接管旧执行。

## 取舍

静态 Provider 组成让初始化、关闭和恢复边界清楚，代价是当前不支持运行中安装或动态增删 Provider。所有 Agent 共用工具集合；差异化工具策略只有在明确需求出现时再由 Archer/Runtime 承担。

模型技能加载通过 Runtime 的 CALL 适配落事实，Skill 实现依然只提供 load；宿主直接读取不自动产生 Agent Effect。Journal 和 Inference 保留各自接口，避免递归自记账或伪装成普通工具。

Provider 是可信代码，来源 revision 依赖作者完整声明 identity；它不等于代码签名或操作系统隔离。多个 Archer 可以共享 Camp，但不能据此宣称同一会话具备分布式并发调度。

## 重新评估条件

出现实际的热替换、多 Agent 差异化策略、依赖图装配或远程提供者需求时，先说明对固定引用、资源借用、未决执行和日志恢复的影响，再扩展当前模型。
