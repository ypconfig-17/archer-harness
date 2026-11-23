import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'data/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['packages/kernel/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*'],
              message: 'Kernel Core 必须保持纯函数，不得依赖 Node API',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: '时间必须由 ctx.now 注入' },
        { object: 'Math', property: 'random', message: 'Kernel Core 不得生成随机数' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'Kernel Core 不得读取进程状态' },
        { name: 'setTimeout', message: 'Kernel Core 不得使用定时器' },
        { name: 'setInterval', message: 'Kernel Core 不得使用定时器' },
        { name: 'fetch', message: 'Kernel Core 不得访问网络' },
      ],
    },
  },
);
