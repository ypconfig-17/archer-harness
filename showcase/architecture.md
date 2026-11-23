# Archer Harness 公开设计导读

Archer 把 Agent Loop 中的决策、执行与能力供给分别交给 Agent、Runtime 和 Camp，用一个小的 Generator 驱动在流程和执行之间交接控制权。这样，同一执行机制可以搭配不同的工具、模型和日志实现。

## 最小内核保留哪条边界

**Kernel 的接口只需要一个 Generator 和一个处理函数。** 在实际接入点 `runCommands` 中，Runtime 把待执行命令放入队列，Generator 每次交出一条命令。处理函数完成后返回后续命令，Generator 把它们追加到队尾。队列推进、命令执行以及异常隔离，在代码里各有明确的位置。 [Kernel 源码](../packages/kernel/src/run.ts) · [Runtime 接入点](../packages/runtime/src/archer/session-runtime.ts#L990)

`try` 只覆盖 `await handler(step.value)`。Handler 失败时，异常经 `program.throw(error)` 回到 Generator，流程可以捕获异常，也可以在 `finally` 中继续交出清理意图。Generator 在 `program.next(result)` 里抛出的异常直接传播给调用方。这条边界保留了 Generator 的原生控制语义，Runtime 可以在外层统一处理执行故障。 [异常边界测试](../tests/kernel/run.test.ts)

## 固定管线保护执行顺序

执行策略以洋葱式 Handler 包装器组合。Archer 的生产管线在一个入口固定装配，当前末端执行 `INFER` 和 `CALL`。以下是装配函数中的实际代码。 [管线装配源码](../packages/handler/src/execution-pipeline.ts#L11)

```ts
return createDispatcher({ INFER: executeInference, CALL: call }, [
  withHumanInteraction,
  withJournal,
  withAuthorization,
  ...(onEffectExecuted ? [withAudit(onEffectExecuted)] : []),
]);
```

| 包装器 | 执行边界 |
| --- | --- |
| `withHumanInteraction` | 合法的人工请求先提交等待事实，随后结束本次驱动 |
| `withJournal` | 确认开始后进入内层，有结果时再提交结果 |
| `withAuthorization` | 能力调用前检查固定目标、输入和命令授权 |
| `withAudit` | 可选的进程内观察，在结果提交前报告调用用时与返回状态 |

顺序本身有意义。人工等待处于外层，所以它可以在执行开始前结束本次驱动。开始提交没有确认时，内层能力调用不会发生；结果提交失败会向 Runtime 传播，由 Runtime 处理故障隔离。测试分别覆盖这两个提交边界，以及人工等待和观测回调的顺序。 [管线行为测试](../tests/handler/execution-pipeline.test.ts#L120)

## 已提交事实定义恢复的边界

Agent 根据同一批事实、新输入和显式上下文推导下一步。模型回复与能力结果作为外部输入回到流程。Runtime 用会话的预期序号提交决策产生的事实，并在能力调用前提交意图与开始事实。生成器暂停的位置只存在于当前进程，重启后的工作由已提交事实重新构建。 [Runtime 提交入口](../packages/runtime/src/archer/session-runtime.ts#L356) · [状态回放测试](../tests/agent/replay.test.ts#L34)

这条规则在写入中断时最清楚。日志里若只有开始事实，Runtime 只能确认调用已开始，写入效果仍待核对。日志里若已有成功结果，Runtime 可以恢复结果而无需再次调用工具。恢复测试比较了这两条路径，并用真实文件写入验证结果提交确认丢失时的行为。 [文件写入恢复导读](recovery.md) · [已提交写入的恢复测试](../tests/archer/recovery.test.ts#L44)

## 能力引用与执行边界

**统一的是能力的声明和管理，调用接口各自保留语义。** `offer(contract, metadata, implementation)` 把版本化契约、可序列化元数据和进程内实现分开。工具实现 `invoke`，技能实现 `load`，推理实现 `infer`，日志提供 `ids`、`read` 和 `append`。Camp 负责验证声明、解析引用以及管理资源，调用方按所需的 Contract 使用能力。 [标准契约](../packages/camp/src/index.ts#L33) · [能力声明入口](../packages/camp/src/index.ts#L83)

本地技能 Provider 能同时说明两种接口为什么有用。每个技能贡献独立的 `Skill.load`，在被加载时读取正文。同一个 Provider 还贡献一个只读 `Tool.invoke`，供任务按需读取技能参考文件。模型获得的是用于调用的工具声明，Runtime 固定的是实际执行所需的能力引用。 [本地技能 Provider](../packages/skills/src/index.ts#L90)

这个引用带有 Provider ID、能力 ID、契约 ID 和来源 revision。同名工具换了来源后，旧调用仍按原引用解析。测试先让一次写入停在待对账状态，再换入同名的新实现；当用户显式选择重试，调用进入阻塞，新实现依然没有被调用。这样，恢复时选中哪个实现可以从事实里查清。 [同名能力换来源的恢复测试](../tests/archer/recovery.test.ts#L31)

## 刷新时保持已有调用可用

Provider 可能需要重新读取配置或发现新的技能。Camp 刷新时先创建并初始化候选。**候选全部就绪后才发布新声明**，初始化失败时当前实例仍可用。发布后的能力列表展示新声明；Camp 有未释放的借用时，仍可解析旧引用。借用排空后才释放退役资源，这给刷新窗口里的执行留出了确定的资源边界。 [刷新实现](../packages/camp/src/index.ts#L275)

测试先取得旧技能引用并保留借用，刷新后验证列表已展示新声明，同时用旧引用读到旧实例的内容。释放借用后，旧引用再被拒绝。另有测试覆盖候选初始化失败、并发刷新与关闭交接。 [刷新与借用测试](../tests/camp/refresh.test.ts#L15)

## 本地验证

在仓库根目录运行：

```bash
pnpm test tests/kernel/run.test.ts tests/camp/refresh.test.ts tests/agent/replay.test.ts tests/archer/recovery.test.ts tests/archer/fs-write-recovery.test.ts
```
