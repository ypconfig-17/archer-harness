# Archer 应用生命周期

`createArcher({ camp })` 同步构造应用，不执行 I/O。`start()` 打开拥有的 Camp 或借用给定实例，取得生命周期借用，然后创建 ArcherContext、加载会话、恢复未决执行，最后开放新任务。

Camp 独立于 Archer。工具与技能由 Runtime 投影，Context 只从 Camp 解析 Journal 与已选推理引用。Archer 不复制 Provider 管理或生命周期。

## 所有权

直接传 Camp 表示借用，`stop()` 不关闭外部 Camp。传入 `Dependency<Camp>` 的 open 工厂表示 Archer 拥有返回的 Opened，由返回的 close 完成最终释放。

```ts
const camp = await createCamp({ providers });
const archer = createArcher({ camp });
try {
  await archer.start();
  const agent = await archer.agents.create({
    id: 'coding', instructions: 'Inspect and complete the requested change.',
    workspace: { cwd: '/absolute/project', access: 'edit' },
  });
  await agent.prompt('Inspect the project.');
} finally {
  await archer.stop();
  await camp.close();
}
```

同一 Camp 可供多个 Archer 借用；停止一个使用方不能关闭其他使用方的 Provider。共享 Journal 的多个 Archer 不提供同一 Agent 的跨实例调度或分布式锁，宿主必须避免并发驱动同一会话。

## 选择与启动

`inference`、`journal` 是可选固定能力引用。省略时对应 Contract 必须恰好一个候选；多个候选明确失败，不按扫描顺序选择。`preparations` 显式选择推理前准备引用，默认空。

恢复逐个会话读取日志并折叠，损坏会话报告包含 Agent 身份的恢复诊断，不改写原文件。其他有效会话继续加载。缺少原始能力或来源修订不匹配时，未执行意图保持 blocked；不能解析成最新的同名能力。

## 停止

停止关闭新准入，取消并等待正在进行的准备与执行，释放 Context，再结束 Camp 借用，最后关闭自己拥有的依赖。停止预算只限制调用方等待，不代表底层工作已经结束；超时后不能提前关闭仍使用中的 Provider。再次 stop 等待同一次清理。

一个实例只能启动一次。停止后的重新启动需创建新 Archer；会话从日志恢复，Generator 对象和执行句柄不恢复。
