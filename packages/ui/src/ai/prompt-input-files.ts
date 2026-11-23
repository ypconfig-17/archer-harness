/** 只折叠本次粘贴，不按输入框累计长度转换，避免改动用户正在编辑的说明。 */
export function shouldAttachPastedText(text: string): boolean {
  return text.length >= 4000 || text.split('\n').length >= 80;
}
