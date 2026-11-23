# Archer Harness

Archer Harness 是一个用 TypeScript 编写的实验性 Agent 工具，提供桌面应用和 HTTP/SSE 服务。可以在桌面创建会话、配置模型、查看工具调用和审阅文件变更。

## 从源码运行

需要 Node.js ≥22.19.0 和 [package.json](package.json) 指定版本的 pnpm。在仓库根目录运行：

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm dev:desktop
```

首次启动默认使用 Mock 推理。使用真实模型时，在桌面设置中配置模型服务，或参考 [模型配置示例](examples/inference.json)，通过 `HARNESS_AI_CONFIG` 指定配置文件的绝对路径。密钥通过 `apiKeyEnv` 引用的环境变量提供。

独立服务可用 `pnpm dev:server` 启动，默认监听 `127.0.0.1:3000`。Shell 和服务访问的使用边界见 [安全说明](SECURITY.md)。

## 开发与验证

```bash
pnpm typecheck
pnpm test
pnpm lint
```

提交问题或改动前请阅读 [贡献指南](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)。第三方源码保留各自的来源和许可，见 [第三方组件说明](packages/ui/THIRD_PARTY.md)。
