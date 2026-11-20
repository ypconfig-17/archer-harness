# 桌面性能边界与采样

界面更新成本应主要由当前可见内容决定，不由会话累计运行时间决定。Agent Events / Journal 仍是唯一事实源；临时推理流仅用于预览。性能采集不执行 Agent、不改动会话、不记录正文或令牌。

## 面板与计时

`AgentDetail` 把中心页签可见性传给活动和上下文面板。初次隐藏时不建立展示投影；已显示后再隐藏时，通过明确的可见性比较保留已有展示树，冻结来自父级的事件更新。再次显示使用最新事件。这样保留请求选择、搜索、筛选、展开状态、分栏及滚动 DOM，而非通过卸载整个面板换取计算减少。面板容器的 `hidden` 仍由所属页签控制；`visible` 是展示计算的准入条件。

活动面板的调用与原始事件子视图采用相同边界；不可见子视图不消费事件或搜索更新。空搜索不序列化 Effect。上下文默认结构页不生成完整请求 JSON；仅原始内容视图实际打开时生成。不对每次新建的投影对象另建序列化缓存。

`EventTimeline` 不持有逐秒状态。`TimelineClock` 仅传递是否运行及显式预览时间；`ElapsedTime` 自己维护耗时文字。结束事实、固定预览时间、显式耗时或缺少开始时间时不启动计时器。公共 `TurnSummary.duration` 接受 ReactNode，以便直接嵌入耗时文字而不重渲染整条摘要或历史树。事实、日志格式、执行和恢复语义不受影响。

流式进度仍通过 SSE 接收、JSON 解析与协议校验后按绘制帧合并。`AgentDetail` 当前仍订阅整份 Agent 进度，尚未实现按 Effect 独立订阅。历史展示投影仍按事件数组更新；本设计不声称已实现可见窗口规模的增量投影。

## 自动验证

```bash
pnpm exec vitest run tests/desktop/renderer/performance-boundaries.test.ts tests/desktop/renderer/event-panel.test.ts tests/desktop/renderer/context-panel.test.ts tests/desktop/renderer/reading-layout.test.ts tests/desktop/renderer/execution-timeline.test.ts
```

DOM 测试使用 jsdom，检查隐藏时不调用事件投影、结构页不生成完整 JSON、空搜索不序列化 Effect、视图及滚动 DOM 保留、逐秒文字更新不触发父级重渲染、结束及预览不启动时钟。测试中的 ResizeObserver 与动画接口仅提供无布局桩，不用于证明浏览器布局性能。

比较计算次数时使用同一固定请求和相同可见状态；不要把“减少一次序列化”换算成未测量的 CPU、帧率或交互延迟提升。

## 可直接运行的采样

脚本要求 Node.js 22 或更新版本，使用内建 WebSocket，无额外运行时依赖。每次最多采样 60 秒。输出只写指定的本地文件，不写业务日志。选择多个候选目标时必须通过 `--target-id` 明确指定，不能按扫描顺序选取。

### Renderer

在下一次正常启动桌面时开启本机调试端口；不要为了采样中断正在执行的 Agent：

```bash
pnpm dev:desktop --remote-debugging-port=9333
node apps/desktop/scripts/profile.mjs --endpoint http://127.0.0.1:9333 --seconds 10 --output /tmp/archer-renderer-idle
```

分别用不同输出名采样静止、连续输入、流式输出、滚动和面板切换。脚本保存 `.cpuprofile` 与 `.json`。前者可在 Chrome DevTools 的 JavaScript Profiler 中加载，查看具体函数栈；后者包含 Long Task 时间与时长、DOM 数量以及 Performance 指标前后值。对 `ScriptDuration`、`LayoutDuration`、`RecalcStyleDuration` 等累计指标求差，不将它们和 CPU 进程百分比混用。该脚本不提供 React 组件 Commit 数据，也不能替代浏览器完整的 Layout / Paint 时间线；需要组件归因时在同一场景补充 React DevTools Profiler。

### Backend

对已运行的 Node 后端发送 SIGUSR1 可开启本机 Inspector，无需重启服务。先确认 PID 确实是 Server 子进程，不能误用桌面主进程或 Renderer PID：

```bash
kill -USR1 <server-pid>
node apps/desktop/scripts/profile.mjs --endpoint http://127.0.0.1:9229 --api-url http://127.0.0.1:<server-port> --seconds 10 --output /tmp/archer-backend-active
```

`--api-url` 可选。提供后，脚本仅在被采样后端内部使用其 HARNESS_TOKEN，读取会话数量、活跃 Turn 数及事件水位。令牌、会话内容与请求正文不写入报告。超过单页容量或响应异常时标记 unknown，不将缺失状态认作空闲。采样报告包含区间进程 CPU 差值、内存、活跃资源类型、事件循环累计值及函数自采样计数。

必须区分无活跃 Turn、等待模型返回、工具执行及日志提交。采样前后都是 idle 且事件水位不变只是空闲候选证据，不能排除区间内曾短暂执行；需要和请求/任务记录共同核对。JS profile 的 idle 不代表所有原生工作线程都空闲。不要仅根据一次 `ps` 输出推断持续 CPU 占用，更不能将不同执行阶段的采样当作优化前后对照。

Inspector 只在诊断期间开启，诊断结束关闭对应连接和自己开启的调试端口；下次常规启动不携带调试参数。不要对同一数据目录同时启动第二个后端来制造空闲样本。

## 后续边界

Renderer 的进度 Store 当前按 Agent 存储 Effect 快照。可在保留单条 SSE 连接和现有按帧合并的前提下，将传输生命周期与快照订阅分开，由当前回复和执行状态按 agentId / effectId 订阅。迁移时必须覆盖切换会话的 release、中断预览和已提交结果优先级，避免多个组件各自建立 SSE 连接。

JSONL Journal 每次 append 读取一次完整文件，并验证已确认前缀的内容摘要；只对新增完整批次和本批草稿进行协议校验。恢复始终完整校验，读取和摘要成本仍随字节数增长；不宣称固定尾部读取。协作提交锁、未知提交和遗留锁约束、测试及基准方法见 [Journal 追加校验与缓存边界](../decisions/journal-append-validation.md)。此存储边界不替代 Renderer 的独立订阅和增量投影。

## React 订阅与长任务采样

`scripts/profile-renderer.mjs` 通过已有 Electron 主进程 Inspector 创建独立诊断窗口，只在该窗口的模块响应中插入 React Profiler。正式组件源码不变，偏好写入限制在诊断窗口内存，业务写请求被拦截。它记录组件自身函数调用、子树提交渲染耗时、投影调用、Store 通知、Long Task、输入到下一 rAF 及实际滚动位移。运行方法、数据有效性限制及当前已观察到的更新传播见 [Renderer 订阅与投影采样](../validation/renderer-subscriptions.md)。
