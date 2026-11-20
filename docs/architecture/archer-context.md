# ArcherContext

ArcherContext 是类型化应用依赖容器。Camp 管理 Provider，Context 使用 Camp 中的基础设施；两者不重复拥有同一资源，也不形成平行能力目录。

`createArcherContext({ camp, journal?, inference?, clock?, configure? })` 解析 `ARCHER_JOURNAL`、`ARCHER_INFERENCE`，提供 `ARCHER_CAMP` 和 `ARCHER_CLOCK`。Journal 解析为实际接口，推理保存固定引用供 Runtime 构造 INFER。默认时钟由 Runtime 显式传入纯决策。

`createServiceToken<T>(name)` 创建有独立身份的 Token。同名 Token 不等同。`createArcherContextBuilder()` 支持 provideValue、provideFactory 和 build；resolve 惰性创建单例，检测缺失或循环依赖。应用通过 `configureContext` 添加自己的服务，不向 Provider 隐式注入容器。

直接提供的值是借用；工厂的 dispose 只释放工厂拥有的资源，逆依赖顺序释放。dispose 幂等且聚合错误。Awilix 仅为内部实现，不暴露其类型或 API。

Context 不选择 Tool、Skill，不管理 Agent 的工作目录、命令授权、Turn 或提交。Provider 所需依赖由宿主显式构造并传入；当前没有 Provider 依赖图自动装配框架。
