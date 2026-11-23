import { Button } from '@archer/ui';
import { useState } from 'react'
import type { JSX } from 'react'
import styles from './SafeImage.module.css'

/**
 * 远程图片的确认加载：默认不发起任何请求，用户点击后才加载，失败可重试。
 * 只有 HTTPS 源会到达这里（渲染层 URL 白名单先行拦截）。
 */
export function SafeImage({ src, alt, title }: { src?: string; alt: string; title?: string }): JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const label = alt.trim() || '远程图片'

  if (!src) return <span className={styles.mediaUnavailable}>图片地址不可用：{label}</span>
  if (!loaded || failed) {
    return (
      <span className={styles.imageConsent}>
        <span>{failed ? `图片加载失败：${label}` : `远程图片：${label}`}</span>
        <Button variant="ghost" onClick={() => { setFailed(false); setLoaded(true); }}>
          {failed ? '重新加载' : '加载图片'}
        </Button>
      </span>
    )
  }

  return (
    <img
      className={styles.image}
      src={src}
      alt={alt}
      title={title}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}
