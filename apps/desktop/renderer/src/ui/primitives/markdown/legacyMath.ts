/**
 * 兼容模型常用的 LaTeX 反斜杠定界符：\(...\) 与 \[...\]。
 *
 * remark-math 只识别 $...$ / $$...$$，而 CommonMark 会把 \( 解析成转义括号，
 * 语法树里已经没有反斜杠，因此只能在解析前改写原文。改写保持代码内容不变：
 * 围栏代码块与行内代码里的示例文本原样保留，避免把文档示例误改成公式。
 *
 * 边界：流式生成过程中未闭合的定界符保持原样，等闭合后的下一帧再转换，
 * 不会提前吞掉后续正文。
 */

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CODE_SPAN = /(`+)[\s\S]*?\1/g;

function convert(segment: string): string {
  return segment
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, body: string) => `\n$$\n${body.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, body: string) => `$${body.trim()}$`);
}

/** 只转换行内代码之外的片段，代码片段按原样拼回。 */
function convertOutsideCodeSpans(text: string): string {
  let result = '';
  let cursor = 0;
  for (const span of text.matchAll(CODE_SPAN)) {
    const index = span.index ?? 0;
    result += convert(text.slice(cursor, index)) + span[0];
    cursor = index + span[0].length;
  }
  return result + convert(text.slice(cursor));
}

/** 逐行跟踪围栏代码块，只对代码块之外的连续文本做定界符改写。 */
export function normalizeLegacyMath(source: string): string {
  const output: string[] = [];
  let fence: string | null = null;
  let chunk: string[] = [];
  const flush = () => {
    if (chunk.length === 0) return;
    output.push(convertOutsideCodeSpans(chunk.join('\n')));
    chunk = [];
  };

  for (const line of source.split('\n')) {
    const marker = FENCE.exec(line)?.[1];
    if (fence) {
      output.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      flush();
      fence = marker;
      output.push(line);
      continue;
    }
    chunk.push(line);
  }
  flush();
  return output.join('\n');
}
