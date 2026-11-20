# 首次运行与模型配置

## 环境与安装

使用 Node.js ≥22.19.0 和根 package.json 的 packageManager 指定版本的 pnpm。在仓库根目录运行：

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm dev:desktop
```

当前提供源码启动入口，没有打包安装程序。本地验证环境为 macOS，其他平台仍需实机确认。若 Electron 下载失败，先检查网络；依赖安装允许 electron 和 esbuild 的构建脚本，不应跳过后直接判断桌面不可用。

首次启动默认使用 Mock，不会发送模型请求。可以先检查设置与导航；实际编码任务需要配置真实模型。

## 配置真实模型

[示例配置](../../examples/inference.json)展示显式 OpenAI Completions 兼容协议的配置结构。它不是可直接访问的服务：必须把 baseURL、defaultModel 和 models 中的 id 替换为你使用的服务信息，并按服务支持能力设置 contextWindow、maxTokens 和 reasoning。协议不匹配时不能只修改地址。

把配置复制到仓库外的绝对路径，例如个人配置目录。密钥只放环境变量，JSON 中的 apiKeyEnv 保存变量名，不保存密钥。以下命令适用于 macOS / Linux 的终端；从同一终端启动应用才能继承环境变量：

```bash
export ARCHER_MODEL_API_KEY='你的模型服务密钥'
export HARNESS_AI_CONFIG='/absolute/private/inference.json'
pnpm dev:desktop
```

桌面也可在设置的模型页面编辑模型服务。apiKeyEnv 对应的环境变量仍需由启动进程提供；页面不接受自定义私有请求头。

Server 首次创建模型设置时读取 HARNESS_AI_CONFIG；已有数据目录中的 model-settings.json 优先。更换文件不会覆盖已有设置，应通过设置页面修改，或显式选择新的数据目录进行独立试用，不要删除已有日志。

本地 CLI 显式选择配置：

```bash
pnpm cli run --ai-config /absolute/private/inference.json -w /absolute/project "概述这个项目，不修改文件"
```

不提供模型配置时，CLI 同样使用 Mock。远程 CLI 的模型由 Server 决定，不接受本地 --ai-config。

## 第一个任务

1. 启动桌面，配置并选择模型。
2. 选择一个存在的绝对工作目录，创建会话。
3. 发送“概述这个项目，不修改文件”，检查答复和活动中的推理、工具结果。
4. 需要执行命令时，根据实际命令决定是否批准；拒绝确认不会赋予执行权限。
5. 如需验证恢复，等待任务结束后正常退出，再启动同一数据目录，检查历史会话。

启动会读取 ~/.agents/skills 与数据目录 skills 下的技能包；非法包或跨来源同名包会明确阻止启动。排查方式见[本地技能说明](../decisions/local-skills.md)，不要为绕过错误静默跳过包。

## 数据与访问边界

- 桌面默认使用 Electron 用户数据目录下的 harness 子目录；CLI 与独立 Server 默认使用各自进程工作目录下的 data。
- HARNESS_DATA_DIR 可显式覆盖数据目录。日志位于 agents，模型设置位于 model-settings.json。
- 日志可能包含用户输入、代码、工具参数和模型输出；不要把整个数据目录上传到 Issue。
- 文件工具受显式工作目录与 read/edit 范围约束；Shell 使用宿主权限，不受文件工具范围替代约束。
- Server 默认仅监听 127.0.0.1:3000。HARNESS_TOKEN 为空时不鉴权；开放到其他机器前必须设置令牌，并自行提供合适的网络访问保护。
- 取消或超时不证明外部操作未发生；遇到 unknown 应检查真实结果后再对账，不能盲目重试。

## 验证与故障定位

```bash
pnpm typecheck
pnpm test
pnpm lint
```

先检查 Mock 能否启动，再检查真实模型配置和凭据。提交问题时附版本、操作系统、复现步骤与脱敏错误；说明是否使用真实模型，勿附密钥或完整会话日志。源码与 HTTP 入口见[运行与接口参考](runtime-usage.md)。
