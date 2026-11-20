# 运行与接口参考

TypeScript + pnpm workspace 的 Agent Harness。Camp 管理 Provider，Contract 定义能力接口，Effect 表达执行意图；Kernel 只负责 Generator 控制权交接。

Archer 协调应用与 Agent 生命周期。Agent 是持续会话，Turn 是一次输入驱动的执行。Runtime 先提交意图再执行能力，取消、未知写入、人工确认和恢复都由日志事实表达。

## 运行

需要 Node.js ≥22.19 和 pnpm。默认推理是确定性的 Mock；真实模型通过设置面板或 HARNESS_AI_CONFIG 配置。

```bash
pnpm install
pnpm build
pnpm dev:desktop
```

Server 默认 `127.0.0.1:3000`。桌面使用 `pnpm dev:desktop`；生产本地桌面先构建，再运行 `pnpm start:desktop`。桌面自管后端使用独立数据目录和管理令牌。开发命令同时启动桌面专属界面服务器，无需单独启动前端或 Server。需要独立 HTTP 服务时使用 `pnpm dev:server`。

```bash
pnpm cli run -w /absolute/project "查看项目架构"
pnpm cli run -w /absolute/project --shell "运行测试"
pnpm cli agents
pnpm cli providers
pnpm cli run -r http://127.0.0.1:3000 -w /absolute/project "查看项目架构"
```

工作目录必须由用户显式选择。文件工具按 Agent 的 read/edit 范围访问；Shell 还需本次 Turn 的 allowShell。Shell 使用宿主系统权限，不是文件或网络沙箱。桌面默认每次询问命令。

## 能力接入

Provider 可提供多个能力，每个能力使用自己的 Contract。内置文件工具、Shell、推理和 Journal 都通过相同机制接入。

```ts
import { createCamp, provider, offer, tool, skill, INFERENCE } from '@archer/camp';
import { createArcher, createMockInference } from '@archer/runtime';
import { toolsProvider, shellProvider } from '@archer/providers';
import { journalProvider } from '@archer/storage';

const git = provider('git', {
  status: tool({
    description: 'Read Git status.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execution: 'read',
    invoke: async (_input, { signal }) => readGitStatus(signal),
  }),
  review: skill({
    name: 'review', description: 'Review changes.',
    load: async () => ({ content: 'Check correctness and tests.' }),
  }),
}, { identity: { implementation: 'git-extension', release: '1' } });

const camp = await createCamp({ providers: [
  toolsProvider(), shellProvider(), git, journalProvider('/absolute/data'),
  provider('inference', {
    model: offer(INFERENCE, { description: 'Mock inference.' }, createMockInference()),
  }),
] });
const archer = createArcher({ camp });
try {
  await archer.start();
  const agent = await archer.agents.create({
    id: 'coding', instructions: 'Complete the requested task and verify the result.',
    workspace: { cwd: '/absolute/project', access: 'edit' },
  });
  await agent.prompt('Inspect the project.');
} finally {
  await archer.stop();
  await camp.close();
}
```

`readGitStatus` 是示例中的业务函数，由扩展实现。Camp 按 Contract 发现与解析；Runtime 把 Tool 和 Skill 投影为模型函数。模型不接触内部容器。Inference.infer 和 Journal 的 ids/read/append 不变成模型工具。

CLI 与 Server 还会接入个人技能包：把 `SKILL.md` 放进 `~/.agents/skills/<name>/` 或数据目录的 `skills/<name>/`，每个技能会投影为一个按需加载函数。前置元数据声明 `name` 与 `description`，`SKILL.md` 最多 64 KiB；能力集合在启动时固定，正文每次加载重读。`references/` 与 `scripts/` 中的文件可由模型通过 `read-resource` 工具按需读取（单文件不超过 32 KiB，路径不能越出技能目录），脚本执行仍使用现有 Shell 授权。跨来源重名会使启动失败。格式与边界见[本地技能包决策](../decisions/local-skills.md)。

直接传 Camp 表示借用；宿主先停止全部使用方再 close。Inference/Journal 只有一个候选时可省略选择，否则 createArcher 必须提供对应固定 ref。SDK 的推理前准备通过 preparations 显式选择。CLI 与 Server 默认选择项目参考准备，读取有体积限制的根约定、README、包信息与目录索引。

## 包与文档

| 包 | 职责 |
| --- | --- |
| contracts | JSON 协议、校验与进程内接口 |
| kernel | 最小 Generator Runner，无包依赖 |
| camp | Provider 声明、引用、契约解析和资源 |
| agent | 纯会话折叠、消息、队列与决策 |
| providers | 文件工具、Shell 与显式工作环境 |
| skills | 个人技能包 Provider（`~/.agents/skills` 与数据目录 `skills/`） |
| memory | 独立持久记忆 Provider |
| handler | Effect 固定管线、提交包装与能力调用 |
| runtime | Archer、Context、唯一串行提交与恢复 |
| storage | JSONL AgentJournal 与 Journal Provider |
| inference-pi | pi-ai 模型推理端口 |
| client | HTTP/SSE 客户端 |

apps 包含 CLI、Fastify Server、Electron Desktop（含独立 React 界面）。入口不重新实现内核调度。桌面界面位于 `apps/desktop/renderer`，生产构建位于 `apps/desktop/dist/renderer`；当前不提供独立 Web 应用。界面遵守[桌面设计系统](../guides/desktop-visual-system.md)，全界面的比例、色系与区域约束见[桌面视觉语言](../decisions/desktop-visual-language.md)。

详见[架构总览](../architecture/kernel.md)、[能力契约](../architecture/capability-contracts.md)、[执行与恢复](../architecture/runtime-design.md)、[公开 API](../architecture/archer-api.md)、[源码导读](../guides/camp-core-code.md)、[记忆配置](../guides/memory.md)。

## Server 配置

| 环境变量 | 含义 |
| --- | --- |
| HOST / PORT | 监听地址和端口，默认 127.0.0.1 / 3000 |
| HARNESS_DATA_DIR | 数据目录，默认进程工作目录下 data；个人技能也读取 ~/.agents/skills |
| HARNESS_TOKEN | 管理接口 Bearer 令牌；为空时关闭鉴权 |
| HARNESS_AI_CONFIG | 显式 pi-ai 配置文件路径 |
| LOG_LEVEL | Server 日志级别，默认 info |

模型配置在设置面板保存，服务端保存私有请求头，公开接口不返回凭据。任务级 provider/model 选择进入事实，不因排队或请求重试改变。

## HTTP 路由

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | /api/health | 健康与推理模式 |
| GET | /api/providers | Provider 与能力声明，只读 |
| GET | /api/skills/:providerId/:capabilityId/:revision | 技能正文，只读 |
| GET | /api/skills/:providerId/:capabilityId/:revision/resource | 技能参考文件，只读 |
| GET / PUT | /api/settings/models | 模型配置 |
| GET / POST | /api/agents | 列表 / 创建 |
| GET / DELETE | /api/agents/:agentId | 快照 / 删除 |
| PUT | /api/agents/:agentId/title | 重命名 |
| PUT | /api/agents/:agentId/execution | 工作环境与当前 Turn 命令授权 |
| POST | /api/agents/:agentId/prompt | 等待 Turn 收束 |
| POST | /api/agents/:agentId/send | 接受输入，返回 TurnRef |
| POST | /api/agents/:agentId/steer | 引导当前 Turn |
| POST | /api/agents/:agentId/follow-up | 后续输入排队 |
| POST | /api/agents/:agentId/abort | 提交取消请求 |
| POST | /api/agents/:agentId/queue/resume | 恢复队列 |
| POST | /api/agents/:agentId/queue/clear | 清空队列 |
| POST | /api/agents/:agentId/human/token | 签发人工凭证 |
| POST | /api/agents/:agentId/human/reply | 人工答复 |
| POST | /api/agents/:agentId/reconcile | 未知操作 retry / abandon |
| POST | /api/agents/:agentId/turns/:turnId/wait | 等待指定 Turn |
| GET | /api/agents/:agentId/turns | Turn 列表 |
| GET | /api/agents/:agentId/turns/:turnId | Turn 快照 |
| GET | /api/agents/:agentId/turns/:turnId/events | Turn 事件 |
| GET | /api/agents/:agentId/turns/:turnId/events/stream | Turn SSE |
| GET | /api/agents/:agentId/events | Agent 事件 |
| GET | /api/agents/:agentId/events/stream | Agent SSE |
| GET | /api/agents/:agentId/progress/stream | 临时推理进度 |
| GET | /api/agents/:agentId/workspace/git-changes | 工作区本地 Git 未提交改动，只读 |

HTTP/SSE 在设置令牌后受入口鉴权。事件 afterSeq / Last-Event-ID 为严格大于；Agent 与 Turn 序号不可混用。进度不属于已提交事实，不参与恢复。

## 持久化与范围

Journal Provider 将 Agent 日志保存为 `data/agents/<id>.jsonl`，记忆维护独立命名空间日志。状态全量回放，没有 checkpoint 或数据库投影；回放不重新执行成功操作。

未知写入必须人工对账；超时和取消不证明操作没发生。来源变化或缺失不能接管旧调用。日志格式与契约不符时明确报告并隔离，不自动删除文件。当前只支持单进程内每 Agent 串行执行，不提供同一会话跨 Archer 的分布式锁。

Handler 支持完整历史视图、累计用量准入，以及支持窗口测量时的完整请求估算与有界历史摘要。摘要与普通推理均记录真实请求和用量，原始历史保留。子 Agent、并行 Effect 与运行时动态安装 Provider 不在当前范围；估算不代表精确 token 或费用硬限制。详见 [Handler 职责与算法](../architecture/handlers.md)。

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

上下文默认保留会话消息原文。支持 measure 时，输入额度扣除生成与安全预留，再留出增长余量；需要整理时按 token 体积保留近期完整批次并生成摘要，不主动按年龄截断工具正文。普通请求的 maxTokens 不因窗口预留被改写。摘要必须符合结构化交接协议，发现、失败方案和决策附带可核实的原文引文，且必须减少候选完整输入，无效候选在原文可容纳时回到原文，超限明确失败。检查面板显示摘要替换统计、准备参考和缓存用量。

显式设置 Turn 的 tokenBudget 后，普通请求和摘要请求的已提交累计输入与输出达到预算就停止后续模型调用；缺失或未知用量时明确失败。已计划工具仍按执行规则完成，单次推理可能使累计值超过预算，因此这不是费用硬上限。缓存读写已包含在输入中，不重复加到合计。

模型输出截断不能结束为成功，空回复有一次继续机会。修改文件后，默认策略会在首次交差时要求复核验证结果；没有权限或环境不支持时需说明未验证原因。工具批次中的独立错误不阻止结构有效的其他调用，命令非零退出明确反馈错误以支持修复与重新检查。

## 推理等级

桌面应用 → 设置 → 上下文，可以选择或编辑声明式策略模板、调整触发阈值与摘要预算、编排步骤顺序并用 ANY / ALL 嵌套条件限定执行时机，还可设置每任务累计 token 预算。默认使用内置“均衡模式”：未整理历史达到 100,000 token 或完整请求超过容量触发线时整理；预留 16,384 token，近期保留目标 20,000 token，实际分别不超过可用输入窗口的 15% 和 25%；工具结果节选只在硬超窗时补救。内置模板只读，修改会自动生成自定义副本并递增修订号。设置保存在当前设备，发送或排队时把解析后的 Profile 深拷贝到新任务；修改不会改变已接受、执行中或重试中的任务。页面只编辑配置，触发判断、摘要采用和安全校验仍由后端完成；最近一次命中可在同一页查看优化前后估算与执行步骤。SDK 对应参数为 `inference.contextProfile` 与 `limits.tokenBudget`，详见 [Handler 说明](../architecture/handlers.md) 与 [策略链决策](../decisions/context-profile-engine.md)。

输入框的模型旁提供中文推理等级选择，各模型独立保存偏好。例如 DeepSeek Flash 显示“关闭、低、高、最高”；不支持推理的模型只显示关闭。模型设置可配置每个模型的推理能力与默认等级。等级随任务提交固定，修改偏好只影响后续任务。

内置目录提供能力范围。自定义模型可通过 reasoning 声明支持能力，defaultReasoning 配置模型默认值，reasoningLevels 收窄允许选择的等级。任务 inference.reasoning 覆盖模型默认值；不支持的等级明确报错。未配置等级的推理模型会自动选择其支持的中或高等级，避免 SDK 把缺省值解释为关闭。较高等级可能增加响应时间和用量。

使用摘要时，请求会附上已提交执行状态参考，未知结果不能被摘要改写为成功。CLI / Server 装配只读 `history.read` 工具，可按 callId 和可选 turnId 分页读取当前 Agent 的历史模型正文，不重跑旧工具、不暴露隐藏结果元数据。SDK 可显式装配 `historyProvider()`。具体限制见 [摘要与历史证据边界](../decisions/context-evidence-boundary.md)。已采用的自由文本摘要不符合当前交接协议，日志回放会明确隔离，不做静默迁移。

摘要交接采用 version: 2，下一步行动明确携带前提和需重读证据，并标注历史覆盖范围。模型可明确返回 no-handoff；该响应不会替换历史，原文超窗时明确停止。含旧交接结构的已采用摘要不符合当前协议，不保留兼容读取。

构建后可用 `node scripts/report-handoff.mjs /absolute/path/agent.jsonl` 只读统计引文开销、采用情况和已报告 token；输出不包含原文，缺失用量单列。这是机械诊断，不能证明任务成功率或摘要语义完整性。

会话删除可从侧栏会话行的 `…`、会话页右上角 `…` 或设置的“对话记录”进入。
运行中的任务需等待实际停止并清空队列，删除会话会保留已提交日志和工作区文件。
侧栏“历史会话无法恢复”提示可打开异常日志管理，也可从设置的对话记录进入：支持查看原因、导出原始 JSONL、逐条或全部移出加载范围。
移出操作保留原始日志到数据目录的 `isolated-agents`，后续启动不再加载；不重试或撤销外部操作，不提供永久删除。
异常管理接口为 `GET /api/recovery-records`、`GET /api/recovery-records/:agentId/export`（返回 `contentBase64`，保留损坏文件的原始字节）和 `DELETE /api/recovery-records/:agentId`，配置 `HARNESS_TOKEN` 时使用 Bearer 鉴权。
