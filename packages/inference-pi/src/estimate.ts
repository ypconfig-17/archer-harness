/**
 * Archer Harness — 请求体积估算
 *
 * 按字符类别折算 token：ASCII（英文、代码与 JSON 结构）平均 4 字符/token，
 * 非 ASCII（主要为 CJK）按 1 字符/token 保守计入。基于 UTF-8 字节的旧口径会把
 * 中文按 3 字节/字符放大，导致提前触发摘要；这里只改变字符权重，消息封装开销
 * 仍由调用方附加。估算不是服务端 tokenizer，不能作为计费或精确窗口上界。
 */

/** ASCII 字符的经验密度：英文、代码与 JSON 结构约 4 字符/token */
const ASCII_CHARS_PER_TOKEN = 4;

/** 非 ASCII 字符的保守权重：CJK 实测约 0.6–0.7 token/字符，取 1 避免低估 */
const NON_ASCII_TOKENS_PER_CHAR = 1;

/**
 * 估算文本 token 数。
 * @param text - 已序列化的完整请求文本。
 * @returns 向上取整的 token 估算。
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let nonAscii = 0;
  // 按 UTF-16 码元计数：非 BMP 字符计入两个非 ASCII 单元，保持偏保守。
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) < 128) ascii += 1;
    else nonAscii += 1;
  }
  return Math.ceil(ascii / ASCII_CHARS_PER_TOKEN + nonAscii * NON_ASCII_TOKENS_PER_CHAR);
}
