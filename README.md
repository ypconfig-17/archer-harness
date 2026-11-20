# Archer Harness

一个探索可靠执行边界的实验性 Agent Harness：以最小 Generator 内核交接控制权，以类型化能力连接 Provider，以已提交事实追踪执行并支持恢复。

项目使用 TypeScript，提供桌面应用、CLI 和 HTTP/SSE 服务。

## Archer 如何执行一次文件写入

Agent 从已提交的事实折叠出会话状态，再根据新输入与显式上下文作出决策。给定相同输入，可以验证决策是否一致。模型回复和工具结果由外部提供，再作为输入交回 Agent。

以一次文件写入为例，Runtime 先提交调用意图和开始事实，再通过固定的能力引用调用 Provider。拿到结果后，Runtime 把结果写回日志。桌面上的调用活动和文件变更回执来自这些已提交事实。

```mermaid
flowchart TD
    A["已提交事实与新输入"] --> B["Agent 产出调用意图"]
    B --> C["Runtime 提交意图与开始事实"]
    C --> D["Provider 执行文件写入"]
    D --> E["结果已确认，提交结果"]
    D --> F["进程中断，结果无法确认"]
    F --> G["恢复为未知，检查文件后对账"]
```

如果文件已写入，进程却在提交结果前退出，重启只能确认这次调用已经开始。Archer 会保留未知状态，等待核对磁盘上的实际内容，避免自动重试覆盖文件。已确认成功的写入可直接从日志恢复结果。 [执行与恢复](docs/architecture/runtime-design.md)

## 最小内核的实际代码

下面是 Kernel 的完整 `run` 函数。Generator 交出一个意图，Kernel 调用传入的 Handler，再把结果或异常交回 Generator。

```ts
export async function run<E, T, R>(
  program: Generator<E, T, R>,
  handler: (effect: E) => R | PromiseLike<R>,
): Promise<T> {
  let step = program.next();
  while (!step.done) {
    let result: R;
    try {
      result = await handler(step.value);
    } catch (error: unknown) {
      step = program.throw(error);
      continue;
    }
    step = program.next(result);
  }
  return step.value;
}
```

写入授权、提交顺序和崩溃恢复由 Runtime 与执行管线处理。Camp 通过 Contract 校验 Provider 声明，并按固定能力引用解析实现。新增工具、技能或推理 Provider 通常沿用同一个 `run` 函数。 [Kernel 源码](packages/kernel/src/run.ts) · [Provider 与能力契约](docs/architecture/capability-contracts.md)

## 当前能力

- 持续会话、多轮输入、后续任务队列与运行中引导。
- 文件读取、编辑与 Shell 命令确认。
- 可配置的模型推理、本地技能包与独立持久记忆 Provider。
- 桌面中的对话、调用活动、请求上下文和工具确认的文件变更审阅。
- JSONL 事实日志、未知操作对账与会话恢复。

## 快速开始

需要 Node.js ≥22.19.0，以及根 `package.json` 指定的 pnpm 版本。当前从源码运行，不提供桌面安装包或已发布的 npm SDK。

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm dev:desktop
```

首次启动默认使用确定性的 Mock 推理，用于验证界面与执行链路，不会调用真实模型。要完成实际任务，请先按[首次运行与模型配置](docs/guides/getting-started.md)配置模型服务，再选择一个存在的绝对工作目录。

本地 CLI：

```bash
pnpm cli run -w /absolute/project "查看项目架构"
```

独立服务：

```bash
pnpm dev:server
```

默认监听 `127.0.0.1:3000`。模型凭据、会话数据和个人技能不应提交到仓库。Shell 使用宿主权限，不是沙箱；桌面默认逐次询问命令。

## 核心设计

| 概念 | 职责 |
| --- | --- |
| Camp | 管理 Provider 声明、能力引用、契约校验和资源生命周期 |
| Contract | 分离可序列化能力元数据与进程内实现接口 |
| Effect | 显式表达 Agent 的执行意图 |
| Agent | 从已提交事实折叠状态，执行纯决策 |
| Runtime | 串行提交事实并执行能力，处理取消与恢复 |
| Kernel | 只交接 Generator 的 yield / next / throw |

接入 Provider 通常无需修改 Kernel。模型只接收标准函数声明和上下文，不直接探索内部能力容器。

## 范围与限制

这是持续演进中的实验项目，当前不承诺持久化格式兼容。升级前请备份数据；不兼容日志会被隔离，不会自动迁移。

- 单进程内每 Agent 最多一个活跃 Turn，每 Turn 最多一个在途 Effect。
- 不提供分布式调度、并行 Effect、子 Agent 或动态代码安装。
- 超时和取消不证明副作用未发生；未知写入不会自动重试，不承诺外部操作 exactly-once。
- 上下文整理保留原始历史，但摘要的语义完整性仍需验证；Token 估算和预算不是费用硬保证。
- 当前本地验证环境为 macOS；Windows / Linux 尚未建立自动验证矩阵。
- 当前验证聚焦执行顺序、事实提交与恢复不变量；尚无与其他框架的速度、Token 消耗或任务成功率对比证据，不宣称这些指标领先。

## 文档与开发

- [首次运行与模型配置](docs/guides/getting-started.md)
- [运行、配置、HTTP 路由与接口参考](docs/guides/runtime-usage.md)
- [架构总览](docs/architecture/kernel.md)与[执行和恢复](docs/architecture/runtime-design.md)
- [Provider 与能力契约](docs/architecture/capability-contracts.md)
- [贡献指南](CONTRIBUTING.md)与[安全说明](SECURITY.md)

```bash
pnpm typecheck
pnpm test
pnpm lint
```

GitHub CI 配置为在 Linux 上验证安装、构建、类型、测试与 lint；桌面窗口、真实模型服务和其他平台仍需单独验证。所有包保持私有发布标记，源码开放不代表 npm 发布。

## 许可证

[MIT](LICENSE)。复制到仓库的第三方源码保留各自的来源与许可，见[组件对照样板说明](apps/desktop/renderer/src/ui/ai-ui/playground/reference/README.md)。
