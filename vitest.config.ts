import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolveWorkspace = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // 界面集成测试复用桌面依赖，根包不重复安装前端运行库。
      '@tanstack/react-query': resolveWorkspace('./apps/desktop/node_modules/@tanstack/react-query'),
      '@archer/memory': resolveWorkspace('./packages/memory/src/index.ts'),
      '@archer/skills': resolveWorkspace('./packages/skills/src/index.ts'),
      '@archer/contracts': resolveWorkspace('./packages/contracts/src/index.ts'),
      '@archer/agent': resolveWorkspace('./packages/agent/src/index.ts'),
      '@archer/kernel': resolveWorkspace('./packages/kernel/src/index.ts'),
      '@archer/inference-pi': resolveWorkspace('./packages/inference-pi/src/index.ts'),
      '@archer/handler': resolveWorkspace('./packages/handler/src/index.ts'),
      '@archer/runtime': resolveWorkspace('./packages/runtime/src/index.ts'),
      '@archer/storage': resolveWorkspace('./packages/storage/src/index.ts'),
      '@archer/camp': resolveWorkspace('./packages/camp/src/index.ts'),
      '@archer/providers': resolveWorkspace('./packages/providers/src/index.ts'),
      '@archer/client': resolveWorkspace('./packages/client/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
  },
});
