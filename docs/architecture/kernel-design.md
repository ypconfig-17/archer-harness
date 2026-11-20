# Kernel — 最小 Generator Runner

## 1. 职责

`@archer/kernel` 只负责在同步 Generator 与注入的 Handler 之间传递执行意图、返回值与异常。它无工作区包依赖，不识别 Effect 类型、路径、Agent、Turn、日志、权限、人工、凭证、取消或恢复。

```text
Generator yield 意图 → Handler 解释 → Generator.next(结果)
                           └─ 抛错 → Generator.throw(异常)
```

Kernel 不维护领域状态，不产出事件与调度命令，不访问时钟、存储或外部能力。异步等待来自 Handler；同步与异步 Handler 均可使用。Agent 的纯决策与事件折叠负责确定性，不能因为 Generator 由 Kernel 驱动就假设任意用户 JavaScript 代码也是确定性的。

## 2. 接口

```ts
run<E, T, R>(
  program: Generator<E, T, R>,
  handler: (effect: E) => R | PromiseLike<R>,
): Promise<T>;
```

`run` 顺序处理 yield。Handler 失败交给流程的 catch/finally；流程自身抛出的异常直接传播，不能被误当成 Handler 异常再次注入。Kernel 不捕获异常后自动重试，不把结果未知伪装成失败。

`R` 是该流程所有恢复值的统一类型。异构 Effect 与各自结果的对应关系由 Contracts 和 Handler 表达。若 `throw` 使流程进入继续 yield 的 `finally`，驱动会交接新的意图，清理结束后未捕获的异常继续向外传播。

```ts
function* workflow(): Generator<string, string, string> {
  const text = yield 'read';
  return yield `save:${text}`;
}

const result = await run(workflow(), handler);
```

示例字符串只说明交接方式；Archer 的实际执行请求由 Contracts 与已提交的 Agent 事实定义，不建立第二套能力注册入口。

## 3. Archer 中的使用

Runtime 从已提交的执行意图构建进程内 Generator。每次 yield 交给宿主 Handler；固定包装器处理人工等待、执行记录和权限，末端调用固定的 Provider 接口。结果及 Agent 后续决定同批进入唯一 AgentJournal，提交确认后才向驱动返回后续命令。

Kernel 不要求使用者手工调用 request/start/outcome，不暴露独立的 Effect 状态机。Agent 的生命周期事实仍可表达 created、started、completed、unknown 或 suspended；这些是会话与执行记录，不是 Kernel 的状态。

## 4. 恢复契约

Archer 只承诺从 Agent 事件日志恢复会话、消息、队列、Turn、人工等待和未解决的执行事实。不保存或恢复 Generator 对象、局部变量、调用栈、yield 序号或任意开发者流程的执行点。

重启时丢弃原驱动，回放事实后重新构建可执行工作：

- 已提交成功结果不重复调用外部能力。
- 已提交意图但没有开始事实，可重建分发或按取消意图收束。
- 已开始且结果未确认的写入进入 unknown，不能因新建 Generator 而绕过。
- 读取或推理按执行契约安全重试；人工等待保持等待，不伪造回复。
- 回放本身不执行外部副作用；外部资源的当前内容仍需重新检查。

恢复决定、重试许可、取消及凭证管理属于 Runtime。实现与 Handler 组合见 [执行管线](execution-pipeline.md)，会话事实见 [Agent 设计](agent-design.md)，串行提交与中断处理见 [Runtime 设计](runtime-design.md)。

使用 `pnpm exec vitest run tests/kernel/run.test.ts tests/archer/fs-write-recovery.test.ts` 验证控制权交接、异常传播与文件写入恢复。
