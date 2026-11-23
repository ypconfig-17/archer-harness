import type { AgentInput, ContentBlock, ImageBlock } from '@archer/contracts';
import type { PromptInputFile } from '@archer/ui';

/** 图片类型与契约保持一致；文本附件在解码后显式校验，不静默丢弃。 */
const IMAGE_TYPES: readonly ImageBlock['mediaType'][] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** 把附件转换为自包含的事实，文本文件按 UTF-8 严格解码，恢复不再读取临时 URL。 */
export function composerInput(text: string, files: readonly PromptInputFile[]): AgentInput {
  const images = files.flatMap<ContentBlock>(file => {
    const mediaType = file.mediaType as ImageBlock['mediaType'];
    const data = file.url.startsWith('data:') ? (file.url.split(',')[1] ?? '') : '';
    if (IMAGE_TYPES.includes(mediaType) && data) return [{ type: 'image', mediaType, data }];
    if (!data || file.mediaType !== 'text/plain') throw new Error('附件未转换完成或类型不受支持');
    const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0') || bytes.length > 256 * 1024) throw new Error('请添加不超过 256 KiB 的 UTF-8 文本文件');
    return [{ type: 'file', filename: file.filename || 'attachment.txt', mediaType: 'text/plain', text }];
  });
  const trimmed = text.trim();
  return images.length
    ? { content: [...(trimmed ? [{ type: 'text' as const, text: trimmed }] : []), ...images] }
    : trimmed;
}
