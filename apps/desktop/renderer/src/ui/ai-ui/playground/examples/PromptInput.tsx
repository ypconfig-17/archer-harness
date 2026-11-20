import { useState } from 'react';
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputHeader,
  PromptInputAttachments,
  PromptInputAttachment,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@archer/ui';

/** 示例只维护本地文本，不上传文件也不提交任务。 */
export default function Example() {
  const [text, setText] = useState('');
  return (
    <div className="example-control example-composer">
      <PromptInput
        accept="image/png,image/jpeg,image/webp,image/gif,text/plain,.txt,.md,.markdown,.json,.csv,.tsv,.log,.yaml,.yml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.sh,.sql,.toml,.ini,.java,.go,.rs,.c,.h,.cpp"
        multiple
        maxFiles={4}
        maxFileSize={5 * 1024 * 1024}
        onSubmit={() => setText('')}
      >
        <PromptInputHeader>
          <PromptInputAttachments>
            {(file) => <PromptInputAttachment data={file} />}
          </PromptInputAttachments>
        </PromptInputHeader>
        <PromptInputBody>
          <PromptInputTextarea
            aria-label="示例任务"
            placeholder="描述你的任务…"
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger />
              <PromptInputActionMenuContent>
                <PromptInputActionAddAttachments label="添加图片或文本文件" />
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
          </PromptInputTools>
          <PromptInputSubmit disabled={!text.trim()} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
