import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../primitives/Collapsible.js';
import { Icon } from '../primitives/Icon.js';

export interface StackFrameView {
  /** 稳定的帧身份；缺省时按位置生成展示键，不用于事实身份。 */
  id?: string;
  file: string;
  line?: number;
  column?: number;
  functionName?: string;
}

/**
 * 只展示宿主提供的结构化帧，不解析原始堆栈字符串。
 * 函数名、行号与列号缺失时保持缺失，不根据文件名或调用顺序补造。
 */
export function StackTrace({
  message,
  frames,
  defaultOpen = false,
}: {
  message: string;
  frames: readonly StackFrameView[];
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible className="ui-stack-trace" defaultOpen={defaultOpen}>
      <CollapsibleTrigger>
        <Icon name="alert" size="sm" />
        <strong>{message}</strong>
        <small>{frames.length} 帧</small>
        <Icon name="chevron-right" size="sm" className="ui-disclosure-chevron" />
      </CollapsibleTrigger>
      <CollapsibleContent keepMounted>
        {frames.length > 0 ? (
          <ol className="ui-stack-frames">
            {frames.map((frame, index) => {
              const location = `${frame.file}${frame.line !== undefined ? `:${frame.line}` : ''}${
                frame.column !== undefined ? `:${frame.column}` : ''
              }`;
              return (
                <li
                  className="ui-stack-frame"
                  key={
                    frame.id ??
                    `${frame.file}:${frame.line ?? ''}:${frame.column ?? ''}:${index}`
                  }
                >
                  <span className="ui-stack-frame-index" aria-hidden="true">
                    {index + 1}
                  </span>
                  {frame.functionName && <code>{frame.functionName}</code>}
                  <span className="ui-stack-frame-location">{location}</span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="ui-stack-empty">未提供堆栈帧。</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
