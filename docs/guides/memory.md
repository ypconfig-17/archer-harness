# 持久化记忆

`@archer/memory` 导出 `memoryProvider({ directory, namespace }, id?)`。directory 必须为绝对路径，namespace 必须显式提供；不扫描工作区配置、不自动保存对话。

```ts
const camp = await createCamp({ providers: [
  memoryProvider({ directory: '/absolute/data/memory', namespace: 'project:archer' }),
  inferenceProvider, journalProvider('/absolute/data'),
] });
const archer = createArcher({ camp });
```

Provider 提供 append/get/search 三个 Tool，以及 context 推理准备契约。Tool 直接进入 Runtime 的模型投影。append 需要调用方给稳定条目 ID、正文，可选 tags/source；同 ID 与规范化输入幂等，不同内容冲突，不覆盖旧数据。get 精确读取；search 按查询检索，返回有限结果。

推理前检索需要显式选择 `camp.list(INFERENCE_PREPARE)` 中 memory.context 的 ref，再通过 Archer.preparations 传入。默认不自动触发。没有显式 query 时读取本次推理快照的最新 user 内容；空查询不注入近期无关记忆。结果是参考数据，不能提高指令优先级。

记忆有独立 JSONL 日志，按命名空间隔离，不依赖 Agent 日志回放重建共享写入。同步确认丢失后冻结追加并报告 COMMIT_UNKNOWN；Runtime 记录未知写入，重启后等待人工 retry/abandon。只有显式 retry 才重用原输入，条目 ID 防止重复插入；不承诺任意外部操作 exactly-once。

关闭 Camp 释放记忆资源；关闭前必须结束所有借用方。数据不会因为 Agent 删除而删除。记忆目录和命名空间进入 Provider identity，恢复不能切换成其他来源。
