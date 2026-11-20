# Camp、Provider 与 Contract

## 声明与接口

`@archer/camp` 导出 `createCamp`、`provider`、`contract`、`offer`、`tool`、`skill` 和标准 Contract。`@archer/contracts` 定义进程内接口与可序列化协议。

```ts
const git = provider('git', {
  status: tool({
    description: 'Read Git status.',
    summary: '查看工作区的 Git 状态。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execution: 'read',
    invoke: async (_input, { signal }) => readStatus(signal),
  }),
  review: skill({
    name: 'review',
    description: 'Review Git changes.',
    load: async () => ({ content: 'Inspect correctness and tests.', revision: 'guide-1' }),
  }),
}, { identity: { implementation: 'git-extension', release: '1' } });
const camp = await createCamp({ providers: [git] });
const entry = camp.list(TOOL)[0]!;
const status = await camp.resolve(entry.ref, TOOL).invoke({}, { signal: camp.signal });
await camp.close();
```

这些 API 没有第二套注册表。Provider 的 `capabilities` 是本地能力 ID 到 Contribution 的映射；一个 Provider 可以贡献多个相同 Contract 的能力。`offer(contract, metadata, implementation)` 分开声明与实现。`tool`、`skill` 是标准契约的声明辅助函数。

## 标准契约

| Contract ID | 实现接口 | 消费方 |
| --- | --- | --- |
| `archer.tool@1` | `invoke(input, context)` | Runtime CALL |
| `archer.skill@1` | `load(context)` | 宿主或 Runtime 的技能加载适配 |
| `archer.inference@1` | `infer(effect, signal, onProgress?)` | INFER Handler |
| `archer.journal@1` | `ids()`、`read()`、`append()` | Runtime 唯一提交端口 |
| `archer.inference.prepare@1` | `prepare(input, context)` | 宿主显式选择的推理前准备 |

Tool 元数据包含模型可见描述、JSON 输入 Schema、执行分类 `read | write | shell`，可选人工交互声明和模型正文投影。可选的 `summary` 是给宿主界面看的中文简述，只进入能力声明，不进入模型消息；缺失时界面退回契约用途。Skill 只声明名称与描述，正文在 load 时返回。基础设施不会因为存在 Contract 就成为模型工具。

自定义 Contract 使用 `contract<Interface, Metadata>('owner.name@1', metadataSchema, methodNames)`。Camp 校验元数据和必需方法；版本 ID 相同意味着提供方和消费方接受同一接口协议。它不验证函数的业务正确性。改变接口或语义时声明新契约版本；不为实现重构添加版本别名。

## 本地技能包

`@archer/skills` 提供本地技能包 Provider。CLI 与 Server 声明 `~/.agents/skills`（来源 `standard`）和 `<HARNESS_DATA_DIR>/skills`（来源 `archer`）两个个人根目录；Provider 不扫描工作区，也没有未声明的默认路径。两个来源内能力 ID 与名称必须全局唯一，冲突或使用保留能力 ID `read-resource` 时启动失败。

每个子目录是一个技能包，必须包含 `SKILL.md`。前置元数据提供 `name` 与 `description`，正文即加载内容；目录名作为 Camp 中的本地能力 ID，`name` 用于模型工具说明与界面展示。其他前置字段（如 `license`、`allowed-tools`）保留但不解释。缺少 `SKILL.md` 的子目录被忽略，整个目录不存在表示当前没有技能。

每个 Provider 实例的能力声明固定。以 ProviderDefinition 接入时，可通过 `camp.refreshProvider(id)` 重建实例，发现新增、删除技能及元数据变化；静态实例没有重建定义，刷新明确拒绝。`load` 每次读取最新正文，返回正文与内容 SHA-256 revision；`SKILL.md` 最多 64 KiB。模型只收到名称与描述，不预加载正文。

`references/`、`scripts/` 和 `assets/` 下的普通文件清单进入技能 metadata（最多 100 项）。参考文件与脚本内容通过同一 Provider 的 `read-resource` Tool 读取：只允许 `references/` 与 `scripts/` 的相对路径，realpath 校验不越出技能目录，单文件最多 32 KiB 且只接受 UTF-8 文本。每次读取都是普通 CALL；脚本不自动执行，`allowed-tools` 不授予权限。设置中的只读预览通过 HTTP 直接调用 `load` 或 `read-resource`，不产生 Agent Effect。

取舍见[本地技能包决策](../decisions/local-skills.md)。

## 固定身份

`CapabilityRef` 包含 `providerId`、`capabilityId`、`contractId`、`revision`。Provider ID 和本地能力 ID 使用普通标识符，不携带目录含义。模型 Function Calling 名称由 Runtime 单独生成，不能作为持久化身份。

revision 是 Provider identity、Contract ID 和元数据的规范化 JSON 的 SHA-256。identity 必须描述影响来源的配置，例如数据目录、命名空间、实现发布版本或服务身份。默认 `{ provider: id }` 只适合没有额外来源区分的声明；Camp 不能检测未声明的代码变化，也不能证明外部服务内容未变。

Camp 拒绝重复 Provider ID、非法能力 ID、缺少方法、不可序列化元数据和引用不匹配。相同契约可以有多个实现；单实例消费方必须显式选择，只有恰好一个候选时才能省略选择。

## 生命周期与所有权

所有声明先校验，随后按 Provider 顺序调用 open；成功交付的资源在失败或关闭时逆序释放。open 失败的 Provider 必须清理自己尚未交付的部分资源。Camp 聚合清理错误，不将它们伪装成成功。

Camp 固定 Provider ID 与宿主提供的创建定义，允许显式刷新对应实例。acquire 返回幂等释放函数；关闭先拒绝新使用，再等待既有借用结束，最后逆序 close。宿主应先停止所有借用方，再关闭 Camp；不要一边关闭共享 Camp 一边继续提交工作。

能力实现是可信进程内代码。execution 分类、只读文件端口和 Schema 不是操作系统沙箱；宿主负责选择可信实现。

## 推理窗口测量

Inference 的 infer 是必需方法，measure 是 Contract.optionalMethods 显式声明的可选同步方法。Camp 只绑定必需方法和已实现的显式可选方法；缺失可选方法表示不支持，非函数实现与重复声明仍拒绝。measure 返回选中模型的窗口、输出上限、完整输入估算和方法标识，不执行外部请求。Handler 使用这些信息做窗口准入；Pi 基于转换后的完整上下文按字符类别折算 token（ASCII 4 字符/token，非 ASCII 1 字符/token），不能视为服务端精确计数。

## 容器刷新

`createCamp` 接受静态 Provider 或 `{ id, create }` 创建定义。工厂只构造独立候选，不提前获取资源；资源由 open 获取，open 失败须自行释放部分资源。每次 create 必须产生可独立关闭的实例，不复用当前资源句柄。Provider 不实现 refresh，也不接触容器。工厂、函数和运行句柄不进入事实。

```ts
const camp = await createCamp({
  providers: [{
    id: 'skills',
    create: () => skillsProvider({ roots }),
  }],
});

await camp.refreshProvider('skills');
```

刷新在 Camp 内串行执行：重新创建、校验完整声明、初始化候选，再无异步间隙发布。候选失败保留当前声明；关闭期间候选不能发布，成功打开的候选必须清理。查询只返回当前声明，Provider 顺序不变。Provider ID 不允许由工厂改变，不支持增删 Provider、自动安装代码或自动依赖装配。新旧实例必须允许短暂共存，独占资源 Provider 不适合此刷新方式。

资源保护沿用 Camp 级 acquire：存在借用时保留退役实例，旧完整引用仍可解析；借用归零后不再提供退役引用，并异步关闭资源。释放函数幂等，关闭等待刷新及资源清理；清理错误由 Camp.close 聚合报告，不回滚已经发布的声明。Archer 的借用覆盖自身生命周期，因此持续运行时连续刷新会保留旧资源直到停止，不提供逐调用排空或内存使用上限。宿主应按需刷新，不在每次推理中无条件重建。

完整引用相同表示来源声明等价，解析优先当前实例；实现作者必须声明有语义差异的来源身份。已经解析出的实现不被替换。跨进程恢复仍按现有完整引用校验，刷新不提供历史实现存储或未知副作用重试。

验证：`pnpm exec vitest run tests/camp tests/skills/skills.test.ts`，覆盖声明更新、失败保持、借用保护、关闭交接，以及技能增删和资源枚举同步刷新。
