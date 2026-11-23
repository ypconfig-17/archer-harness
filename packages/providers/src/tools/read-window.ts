/**
 * Archer Harness — read 工具的行窗口
 *
 * 逐块消费文本流，统计总行数并只保留请求窗口；单行、输出字节与总行数
 * 都有上限，避免大文件把完整内容带进上下文。实现移植自 deepseek-harness
 * 的 tool-fs/read-render.ts（MIT，Copyright (c) 2026 DeepSeek）。
 */

import {
  toolReadFooter,
  toolReadLine,
  toolReadLineTruncated,
  toolReadOffsetOutOfRange,
} from './prompt.js';
import { ToolInputError } from './types.js';

export interface ReadWindowRequest {
  offset: number;
  limit: number;
  maxLineLength: number;
  maxBytes: number;
}

export interface FileTextLine {
  number: number;
  text: string;
}

export interface ReadWindowResult {
  lines: FileTextLine[];
  totalLines: number;
  truncatedByBytes: boolean;
}

interface WindowAccumulator {
  lines: FileTextLine[];
  totalLines: number;
  outputBytes: number;
  truncatedByBytes: boolean;
}

export async function buildReadWindow(
  chunks: AsyncIterable<string>,
  request: ReadWindowRequest,
  displayPath: string,
): Promise<ReadWindowResult> {
  const acc: WindowAccumulator = {
    lines: [],
    totalLines: 0,
    outputBytes: 0,
    truncatedByBytes: false,
  };
  const lineBufferCap = request.maxLineLength + 1;
  let lineBuffer = '';

  function appendToLineBuffer(segment: string): void {
    if (lineBuffer.length >= lineBufferCap) return;
    lineBuffer += segment;
    if (lineBuffer.length > lineBufferCap) {
      lineBuffer = lineBuffer.slice(0, lineBufferCap);
    }
  }

  function flushLine(): void {
    const raw = lineBuffer.endsWith('\r') ? lineBuffer.slice(0, -1) : lineBuffer;
    consumeLine(acc, raw, request);
    lineBuffer = '';
  }

  for await (const chunk of chunks) {
    let startPos = 0;
    let newlinePos: number;
    while ((newlinePos = chunk.indexOf('\n', startPos)) !== -1) {
      appendToLineBuffer(chunk.slice(startPos, newlinePos));
      flushLine();
      startPos = newlinePos + 1;
    }
    appendToLineBuffer(chunk.slice(startPos));
  }
  if (lineBuffer.length > 0) flushLine();

  if (
    !acc.truncatedByBytes
    && request.offset > acc.totalLines
    && !(acc.totalLines === 0 && request.offset === 1)
  ) {
    throw new ToolInputError(
      toolReadOffsetOutOfRange(request.offset, acc.totalLines, displayPath),
      'PROVIDER_ERROR',
    );
  }

  return {
    lines: acc.lines,
    totalLines: acc.totalLines,
    truncatedByBytes: acc.truncatedByBytes,
  };
}

export function renderReadWindow(offset: number, result: ReadWindowResult): string {
  const endLine = result.lines.at(-1)?.number ?? Math.max(0, offset - 1);
  const footer = toolReadFooter(
    offset,
    endLine,
    result.totalLines,
    result.truncatedByBytes,
  );
  const body = result.lines.map((line) => toolReadLine(line.number, line.text)).join('\n');
  return body.length > 0 ? `${body}\n\n${footer}` : footer;
}

function consumeLine(
  acc: WindowAccumulator,
  rawLine: string,
  request: ReadWindowRequest,
): void {
  acc.totalLines += 1;
  if (
    acc.truncatedByBytes
    || acc.totalLines < request.offset
    || acc.lines.length >= request.limit
  ) {
    return;
  }

  const text = rawLine.length > request.maxLineLength
    ? `${rawLine.slice(0, request.maxLineLength)}${toolReadLineTruncated(request.maxLineLength)}`
    : rawLine;
  const bytes = Buffer.byteLength(text, 'utf8') + (acc.lines.length > 0 ? 1 : 0);
  if (acc.outputBytes + bytes > request.maxBytes) {
    acc.truncatedByBytes = true;
    return;
  }
  acc.outputBytes += bytes;
  acc.lines.push({ number: acc.totalLines, text });
}
