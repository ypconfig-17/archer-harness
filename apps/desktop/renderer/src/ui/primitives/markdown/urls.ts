/**
 * 正文链接与图片的协议白名单。渲染前的 urlTransform 与图片组件都复用这里，
 * 保证任何入口（显式链接、自动链接、图片）都过同一套判断。
 */

/** 链接只允许绝对 HTTP(S)；其余协议与相对地址返回空串，由渲染层降级为纯文本。 */
export function sanitizeLinkUrl(url: string): string {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:' ? url : '';
  } catch {
    return '';
  }
}

/** 图片只允许绝对 HTTPS；返回 undefined 表示不生成可请求地址。 */
export function sanitizeImageUrl(url: string): string | undefined {
  try {
    return new URL(url).protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}
