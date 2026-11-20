import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { firstPaintCss } from './renderer/src/ui/theme/first-paint';

/**
 * 首帧带主题底色，避免样式表加载前闪白。
 * 背景值从 design-tokens.css 生成，index.html 只留占位注释，不再维护第二份色值。
 */
function themeFirstPaint(): Plugin {
  const tokens = fileURLToPath(new URL('./renderer/src/ui/theme/design-tokens.css', import.meta.url));
  return {
    name: 'archer-theme-first-paint',
    transformIndexHtml: {
      order: 'pre',
      handler(html: string) {
        if (!html.includes('<!--theme-first-paint-->')) throw new Error('index.html 缺少 <!--theme-first-paint--> 占位');
        const css = readFileSync(tokens, 'utf8');
        return html.replace('<!--theme-first-paint-->', `<style>${firstPaintCss(css)}</style>`);
      },
    },
  };
}

/** 桌面界面单独构建，不能清空同一 dist 下的主进程与 preload。 */
export default defineConfig({
  root: fileURLToPath(new URL('./renderer', import.meta.url)),
  base: './',
  plugins: [themeFirstPaint(), react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
});