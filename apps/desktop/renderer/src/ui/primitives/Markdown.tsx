/**
 * 正文 Markdown 的唯一渲染入口：Streamdown 负责解析、流式块与官方交互，
 * shadcn/typeset 负责块级排版，Archer 只保留主题桥接与安全边界。
 *
 * 安全边界：
 * - 原始 HTML 在渲染前改写成字面文本，不生成可执行节点；
 * - 链接只允许绝对 HTTP(S)，其余目标不生成 href；
 * - 图片只允许绝对 HTTPS，并且默认不请求，由用户点击后加载；
 * - KaTeX 保持默认 trust 关闭，Mermaid 固定 securityLevel: strict。
 */

import { memo, useEffect, useMemo, useState } from 'react'
import type { ComponentProps, JSX } from 'react'
import { Streamdown, defaultRemarkPlugins } from 'streamdown'
import { createCodePlugin } from '@streamdown/code'
import { cjk } from '@streamdown/cjk'
import { createMathPlugin } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'
import { createCssVariablesTheme } from 'shiki/core'
import { SafeImage } from './markdown/SafeImage'
import { normalizeLegacyMath } from './markdown/legacyMath'
import { sanitizeImageUrl, sanitizeLinkUrl } from './markdown/urls'
import { remarkLiteralHtml } from './markdown/remarkLiteralHtml'
import 'katex/dist/katex.min.css'
import 'streamdown/styles.css'

type StreamdownProps = ComponentProps<typeof Streamdown>

/** 与主题 Token 共用的 --shiki-* 变量，代码块颜色跟随明暗与强调色。 */
const shikiTheme = createCssVariablesTheme({
  name: 'css-variables',
  variablePrefix: '--shiki-',
  fontStyle: true,
})

/** 明暗两态共用同一套 CSS 变量主题，数组保持稳定以复用 Streamdown 的缓存块。 */
const shikiThemes: NonNullable<StreamdownProps['shikiTheme']> = [shikiTheme, shikiTheme]

/** 图表只使用严格安全模式；主题跟随界面明暗，避免深色界面出现白底图表。 */
function useMermaidTheme(): 'dark' | 'default' {
  // 服务端渲染没有 document，默认使用浅色主题；浏览器首帧由实际外观决定。
  const read = () => typeof document !== 'undefined' && document.documentElement.dataset.appearance === 'dark' ? 'dark' : 'default'
  const [theme, setTheme] = useState<'dark' | 'default'>(read)
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-appearance'] })
    return () => observer.disconnect()
  }, [])
  return theme
}

const plugins = {
  code: createCodePlugin({ themes: [shikiTheme, shikiTheme] }),
  cjk,
  math: createMathPlugin({ singleDollarTextMath: true }),
  mermaid,
}

/**
 * 传入自定义 remark 插件会替换 Streamdown 的默认集合，因此先保留官方默认
 * （GFM、代码围栏元信息），再追加原始 HTML 字面化。
 */
const remarkPlugins = [
  ...Object.values(defaultRemarkPlugins),
  remarkLiteralHtml,
] as unknown as StreamdownProps['remarkPlugins']

/** 链接与图片共用同一条协议规则；返回 undefined 时属性被移除，元素降级为纯文本。 */
const urlTransform: NonNullable<StreamdownProps['urlTransform']> = (url, key) => {
  if (key === 'src') return sanitizeImageUrl(url)
  return sanitizeLinkUrl(url) || undefined
}

/** 远程图片保留“用户主动加载”的边界，其余图片节点交给 SafeImage 的不可用提示。 */
const components: NonNullable<StreamdownProps['components']> = {
  img: ({ src, alt, title }) => (
    <SafeImage
      src={typeof src === 'string' ? src : undefined}
      alt={alt ?? ''}
      title={typeof title === 'string' ? title : undefined}
    />
  ),
}

/** 关闭官方链接确认弹层：协议已在渲染前过滤，点击行为保持直接打开。 */
const linkSafety: NonNullable<StreamdownProps['linkSafety']> = { enabled: false }

/** 官方控件随桌面界面统一使用中文；格式缩写保持原样。 */
const translations: NonNullable<StreamdownProps['translations']> = {
  close: '关闭',
  copied: '已复制',
  copyCode: '复制代码',
  copyLink: '复制链接',
  copyTable: '复制表格',
  copyTableAsCsv: '复制为 CSV',
  copyTableAsMarkdown: '复制为 Markdown',
  copyTableAsTsv: '复制为 TSV',
  downloadDiagram: '下载图表',
  downloadDiagramAsMmd: '下载 MMD',
  downloadDiagramAsPng: '下载 PNG',
  downloadDiagramAsSvg: '下载 SVG',
  downloadFile: '下载文件',
  downloadImage: '下载图片',
  downloadTable: '下载表格',
  downloadTableAsCsv: '下载 CSV',
  downloadTableAsMarkdown: '下载 Markdown',
  errorMermaid: '图表渲染失败',
  exitFullscreen: '退出全屏',
  externalLinkWarning: '外部链接提示',
  imageNotAvailable: '图片不可用',
  mermaidAriaLabel: 'Mermaid 图表',
  mermaidFormatMmd: 'MMD',
  mermaidFormatPng: 'PNG',
  mermaidFormatSvg: 'SVG',
  openExternalLink: '打开外部链接',
  openLink: '打开链接',
  resetView: '重置视图',
  tableFormatCsv: 'CSV',
  tableFormatMarkdown: 'Markdown',
  tableFormatTsv: 'TSV',
  viewFullscreen: '全屏查看',
  zoomIn: '放大',
  zoomOut: '缩小',
}

// 历史正文不随计时与其他推理增量重新解析；主题仍由组件自身订阅更新。
export const Markdown = memo(function Markdown({ text: sourceText, streaming = false }: {
  text: string
  streaming?: boolean
}): JSX.Element | null {
  // 累计增量到达后立即渲染，不再排入人为吐字队列，避免终态一次性补齐积压正文。
  const text = useMemo(() => normalizeLegacyMath(sourceText), [sourceText])
  const mermaidTheme = useMermaidTheme()
  /** 配置对象只在明暗切换时重建，普通重渲染保持稳定，避免打断 Streamdown 的 memo 比较。 */
  const mermaidOptions = useMemo<NonNullable<StreamdownProps['mermaid']>>(
    () => ({ config: { securityLevel: 'strict', theme: mermaidTheme } }),
    [mermaidTheme],
  )

  if (!streaming && text.trim() === '') return null

  return (
    <Streamdown
      /**
       * Mermaid 只在块首次渲染时读取主题配置，流式块缓存不会因配置变化重绘；
       * 用外观作为 key 重建整棵正文，确保切换明暗后图表与界面一致。
       */
      key={mermaidTheme}
      className="typeset archer-markdown-typeset"
      mode={streaming ? 'streaming' : 'static'}
      isAnimating={streaming}
      plugins={plugins}
      remarkPlugins={remarkPlugins}
      components={components}
      urlTransform={urlTransform}
      linkSafety={linkSafety}
      translations={translations}
      mermaid={mermaidOptions}
      shikiTheme={shikiThemes}
    >
      {text}
    </Streamdown>
  )
})
