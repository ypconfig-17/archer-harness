# Camp 核心代码导读

从一条模型工具调用阅读当前实现：

1. `packages/camp/src/index.ts`：provider/offer 声明，校验 Contract，生成来源 revision，初始化与释放资源。
2. `packages/providers/src/tools.ts` 与 `shell.ts`：内置能力也是普通 Provider，invoke 从 OperationContext 取得 Agent 的工作环境。
3. `packages/runtime/src/context/application-context.ts`：从 Camp 解析 Journal 与固定 Inference 引用。
4. `packages/runtime/src/prompt/model-tools.ts`：Tool/Skill 元数据投影为模型函数，内部映射保存 CapabilityRef。
5. `packages/agent/src/policies/function-call.ts`：模型工具调用绑定到已提交映射，产出 CALL 草稿和命令。
6. `packages/runtime/src/archer/session-runtime.ts`：提交、解析原目标、审批和分发，结果进入同一串行提交边界。
7. `packages/runtime/src/execution/targets.ts`：Tool.invoke 与 Skill.load 的实际接口适配。
8. `packages/handler/src/execution-pipeline.ts`：固定装配执行包装；`infer.ts` 执行推理，`call.ts` 调用能力并按 read/write/shell 语义归类结果。
9. `packages/storage/src/agent-journal.ts`：JSONL 批次、序号 CAS、持久化与格式校验。

本地技能包的扫描、`SKILL.md` 解析、资源清单与受限读取在 `packages/skills/src/`；它贡献 `archer.skill@1` 和普通 `read-resource` Tool，加载适配仍由 `targets.ts` 完成。

例如模型只看到 `files_read_<hash>`、描述和 JSON Schema。日志中的 CALL 额外保存 `{ providerId: 'files', capabilityId: 'read', contractId: 'archer.tool@1', revision: '...' }`。文件参数 `src/index.ts` 是工作环境路径，与能力身份互相独立。

`tests/camp/` 验证独立容器；`tests/archer/` 验证执行和恢复；`tests/providers/` 验证真实文件和 Shell 边界。测试模型从当次提供的 tools 选择名称，不猜测函数名。
