import { useState } from "react";
import {
  FileTextIcon,
  TerminalIcon,
  CheckIcon,
  ClockIcon,
} from "@phosphor-icons/react";
import { Button } from "./upstream/button";
import { Input } from "./upstream/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./upstream/card";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "./upstream/select";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "./upstream/dialog";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
} from "./upstream/popover";
import { Message, MessageContent, MessageHeader } from "./upstream/message";
import {
  Trace,
  TraceLine,
  TraceIcon,
  TraceTitle,
  TraceDescription,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
} from "./upstream/trace";
import {
  CodeBlock,
  CodeBlockHeader,
  CodeBlockTitle,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockContent,
  CodeBlockLine,
} from "./upstream/code-block";
import type { SampleState } from "./protocol";

/** 两侧共用同一份 JSX、官方组件和状态，只允许主题映射不同。 */
export function Specimen({ state }: { state: SampleState }) {
  const [name, setName] = useState("优化 Skills 加载");
  const [workspace, setWorkspace] = useState("current");
  const [draftName, setDraftName] = useState(name);
  const [saved, setSaved] = useState(false);
  const [planOpen, setPlanOpen] = useState(true);
  const done = state === "completed";
  const output =
    state === "error"
      ? "示例：目标目录不可写，未自动重试。"
      : "Fixed preview output.\n2 checks passed.";
  return (
    <div className="specimen">
      <section className="specimen-section">
        <h2>Button · Input</h2>
        <div className="specimen-actions">
          <Button>主操作</Button>
          <Button variant="secondary">次要</Button>
          <Button variant="outline">描边</Button>
          <Button disabled>禁用</Button>
        </div>
        <label className="specimen-field">
          任务名称
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <Input
          aria-label="错误输入示例"
          aria-invalid={state === "error"}
          placeholder={state === "error" ? "请输入有效名称" : "输入任务说明…"}
        />
      </section>
      <section className="specimen-section">
        <h2>Card · Select · Dialog · Popover</h2>
        <Card>
          <CardHeader>
            <CardTitle>工作区设置</CardTitle>
            <CardDescription>保持官方的表面、边界与内部间距。</CardDescription>
          </CardHeader>
          <CardContent>
            <label className="specimen-field">工作目录</label>
            <Select
              items={[
                { value: "current", label: "当前项目" },
                { value: "example", label: "示例目录" },
              ]}
              value={workspace}
              onValueChange={(value) => setWorkspace(value ?? "current")}
            >
              <SelectTrigger className="w-full" aria-label="工作目录">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current">当前项目</SelectItem>
                <SelectItem value="example">示例目录</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
          <CardFooter className="specimen-actions">
            <Dialog
              onOpenChange={(open) => {
                // 每次打开重新取值，取消时不把草稿泄漏到已保存的预览。
                if (open) setDraftName(name);
              }}
            >
              <DialogTrigger render={<Button />}>编辑说明</DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>编辑任务说明</DialogTitle>
                  <DialogDescription>
                    仅修改这个预览，不保存业务配置。
                  </DialogDescription>
                </DialogHeader>
                <Input
                  aria-label="弹窗任务名称"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                />
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>
                    取消
                  </DialogClose>
                  <DialogClose
                    render={<Button />}
                    onClick={() => {
                      setName(draftName);
                      setSaved(true);
                    }}
                  >
                    保存预览
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Popover>
              <PopoverTrigger render={<Button variant="outline" />}>
                查看说明
              </PopoverTrigger>
              <PopoverContent side="bottom" align="start">
                <PopoverTitle>样式来源</PopoverTitle>
                <PopoverDescription>
                  两侧使用同一份官方 Rhea 源码，Archer 侧只映射主题语义。
                </PopoverDescription>
              </PopoverContent>
            </Popover>
          </CardFooter>
        </Card>
        {saved && (
          <p className="specimen-note" role="status">
            已更新本地预览。
          </p>
        )}
      </section>
      <section className="specimen-section">
        <h2>Message · 公开反馈</h2>
        <Message>
          <MessageContent>
            <MessageHeader>Archer · 10:24</MessageHeader>
            <p>我先检查现有实现，再核对工具输出和计划展示。</p>
          </MessageContent>
        </Message>
      </section>
      <section className="specimen-section">
        <h2>Tool · 执行活动</h2>
        <Trace>
          <TraceLine>
            <TraceIcon>
              <FileTextIcon />
            </TraceIcon>
            <TraceTitle>已读取设计文档</TraceTitle>
            <TraceDescription>2 个文件</TraceDescription>
          </TraceLine>
          <TraceCollapsible>
            <TraceCollapsibleTrigger>
              <TraceLine
                status={
                  state === "error"
                    ? "error"
                    : state === "running"
                      ? "running"
                      : undefined
                }
              >
                <TraceIcon>
                  <TerminalIcon />
                </TraceIcon>
                <TraceTitle>
                  {state === "error"
                    ? "写入报告失败"
                    : done
                      ? "已运行类型检查"
                      : "正在运行类型检查"}
                </TraceTitle>
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent keepMounted>
              <CodeBlock size="sm">
                <CodeBlockContent wrap>{output}</CodeBlockContent>
              </CodeBlock>
            </TraceCollapsibleContent>
          </TraceCollapsible>
        </Trace>
      </section>
      <section className="specimen-section">
        <h2>Plan · 模型声明</h2>
        <Trace>
          <TraceCollapsible open={planOpen} onOpenChange={setPlanOpen}>
            <TraceCollapsibleTrigger>
              <TraceLine
                status={done || state === "error" ? undefined : "running"}
              >
                <TraceIcon>{done ? <CheckIcon /> : <ClockIcon />}</TraceIcon>
                <TraceTitle>核对组件展示</TraceTitle>
                <TraceDescription>
                  {done ? "2/2" : "1/2"} · 模型声明
                </TraceDescription>
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent keepMounted>
              <Trace>
                <TraceLine>
                  <TraceIcon>
                    <CheckIcon />
                  </TraceIcon>
                  <TraceTitle>读取会话与设计记录</TraceTitle>
                </TraceLine>
                <TraceLine
                  status={done || state === "error" ? undefined : "running"}
                >
                  <TraceIcon>{done ? <CheckIcon /> : <ClockIcon />}</TraceIcon>
                  <TraceTitle>
                    {done
                      ? "已核对界面约束"
                      : state === "error"
                        ? "核对界面约束尚未完成"
                        : "正在核对界面约束"}
                  </TraceTitle>
                </TraceLine>
              </Trace>
            </TraceCollapsibleContent>
          </TraceCollapsible>
        </Trace>
      </section>
      {done && (
        <section className="specimen-section">
          <h2>Message · 最终答复</h2>
          <Message>
            <MessageContent>
              <MessageHeader>Archer · 10:26</MessageHeader>
              <p>
                示例检查已完成。组件来源、主题映射与交互边界已整理，可继续查看具体工具输出。
              </p>
            </MessageContent>
          </Message>
        </section>
      )}
      <section className="specimen-section">
        <h2>Code Block · 增删行</h2>
        <CodeBlock>
          <CodeBlockHeader>
            <CodeBlockTitle>display.ts</CodeBlockTitle>
            <CodeBlockActions>
              <CodeBlockCopyButton
                value={"return unknownResult;\nreturn confirmedResult;"}
              />
            </CodeBlockActions>
          </CodeBlockHeader>
          <CodeBlockContent lineNumbers wrap>
            <CodeBlockLine variant="removed">
              return unknownResult;
            </CodeBlockLine>
            <CodeBlockLine variant="added">
              return confirmedResult;
            </CodeBlockLine>
          </CodeBlockContent>
        </CodeBlock>
        <p className="specimen-note">
          固定示例，不表示真实调用、变更或完成结果。
        </p>
      </section>
    </div>
  );
}
