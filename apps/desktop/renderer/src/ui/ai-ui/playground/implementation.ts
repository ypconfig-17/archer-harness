import type { CatalogEntry } from "./catalog";

// 直接读取组件实现，避免把示例代码误标成组件源码。
const sourceFiles = import.meta.glob(
  "../../../../../../../packages/ui/src/**/*.{ts,tsx}",
  {
    eager: true,
    query: "?raw",
    import: "default",
  },
) as Record<string, string>;

const upstreamRevision = "e62c9435fff729a175f38983dee73b2cb4f6a069";
const upstreamFiles: Record<string, string> = {
  "ai/Trace.tsx": "trace.tsx",
  "primitives/Collapsible.tsx": "collapsible.tsx",
  "primitives/Select.tsx": "select.tsx",
  "primitives/DropdownMenu.tsx": "dropdown-menu.tsx",
  "primitives/InputGroup.tsx": "input-group.tsx",
};
// AI Elements 不随 shadcn 仓库发版，来源记录 registry 条目。
const aiElementSources: Record<string, string> = {
  "ai/PromptInput.tsx": "https://registry.ai-sdk.dev/prompt-input.json",
};
const groups = [
  ["ai/PlanHistory.tsx", ["PlanHistory"]],
  [
    "ai/elements.tsx",
    [
      "AgentTurn",
      "MessageHeader",
      "ProgressParagraph",
      "ActivityGroup",
      "Plan",
      "InteractionCard",
    ],
  ],
  [
    "ai/conversation.tsx",
    ["TurnSummary", "AssistantAnswer", "InteractionRecord", "ExecutionNotice"],
  ],
  ["ai/ConversationViewport.tsx", ["ConversationViewport"]],
  [
    "ai/Trace.tsx",
    [
      "Trace",
      "TraceLine",
      "TraceIcon",
      "TraceTitle",
      "TraceDescription",
      "TraceCollapsible",
      "TraceCollapsibleTrigger",
      "TraceCollapsibleContent",
    ],
  ],
  ["ai/Tool.tsx", ["Tool", "Reasoning"]],
  ["ai/Message.tsx", ["Message"]],
  ["ai/Sources.tsx", ["Sources", "Source"]],
  ["ai/InlineCitation.tsx", ["InlineCitation"]],
  ["ai/Suggestion.tsx", ["Suggestions", "Suggestion"]],
  ["ai/StackTrace.tsx", ["StackTrace"]],
  ["ai/TestResults.tsx", ["TestResults"]],
  ["ai/FileTree.tsx", ["FileTree"]],
  ["ai/ExecutionPatterns.tsx", ["Task", "Confirmation", "Terminal"]],
  [
    "primitives/Surface.tsx",
    [
      "Button",
      "FloatingSurface",
      "DialogHeader",
      "DialogActions",
      "FormField",
      "ConfirmDialog",
    ],
  ],
  ["primitives/Input.tsx", ["Input"]],
  [
    "primitives/Card.tsx",
    [
      "Card",
      "CardHeader",
      "CardTitle",
      "CardDescription",
      "CardContent",
      "CardFooter",
    ],
  ],
  ["primitives/Dialog.tsx", ["Dialog"]],
  ["primitives/Popover.tsx", ["Popover"]],
  [
    "primitives/Select.tsx",
    [
      "Select",
      "SelectTrigger",
      "SelectValue",
      "SelectContent",
      "SelectGroup",
      "SelectLabel",
      "SelectItem",
      "SelectSeparator",
      "SelectScrollUpButton",
      "SelectScrollDownButton",
    ],
  ],
  ["primitives/NativeSelect.tsx", ["NativeSelect"]],
  [
    "primitives/DropdownMenu.tsx",
    [
      "DropdownMenu",
      "DropdownMenuPortal",
      "DropdownMenuTrigger",
      "DropdownMenuContent",
      "DropdownMenuGroup",
      "DropdownMenuLabel",
      "DropdownMenuItem",
      "DropdownMenuCheckboxItem",
      "DropdownMenuRadioGroup",
      "DropdownMenuRadioItem",
      "DropdownMenuSeparator",
      "DropdownMenuShortcut",
      "DropdownMenuSub",
      "DropdownMenuSubTrigger",
      "DropdownMenuSubContent",
    ],
  ],
  ["primitives/SegmentedControl.tsx", ["SegmentedControl"]],
  [
    "primitives/Collapsible.tsx",
    ["Collapsible", "CollapsibleTrigger", "CollapsibleContent"],
  ],
  ["primitives/Sidebar.tsx", ["Sidebar", "SidebarGroup", "SidebarItem"]],
  [
    "primitives/Field.tsx",
    ["Field", "FieldLabel", "FieldDescription", "FieldError", "FieldGroup"],
  ],
  [
    "primitives/InputGroup.tsx",
    [
      "InputGroup",
      "InputGroupAddon",
      "InputGroupButton",
      "InputGroupInput",
      "InputGroupText",
      "InputGroupTextarea",
    ],
  ],
  [
    "ai/PromptInput.tsx",
    [
      "PromptInput",
      "PromptInputActionAddAttachments",
      "PromptInputActionMenu",
      "PromptInputActionMenuContent",
      "PromptInputActionMenuItem",
      "PromptInputActionMenuTrigger",
      "PromptInputAttachment",
      "PromptInputAttachments",
      "PromptInputBody",
      "PromptInputButton",
      "PromptInputFooter",
      "PromptInputHeader",
      "PromptInputSubmit",
      "PromptInputTextarea",
      "PromptInputTools",
      "usePromptInputAttachments",
    ],
  ],
  ["primitives/Icon.tsx", ["Icon"]],
  ["primitives/Record.tsx", ["RecordDisclosure", "RecordRow"]],
  [
    "renderers/CodeBlock.tsx",
    [
      "CodeBlock",
      "CodeBlockActions",
      "CodeBlockContent",
      "CodeBlockCopyButton",
      "CodeBlockFooter",
      "CodeBlockHeader",
      "CodeBlockLine",
      "CodeBlockTitle",
    ],
  ],
  ["renderers/CodeSnippet.tsx", ["CodeSnippet"]],
  ["primitives/Checkbox.tsx", ["Checkbox"]],
] as const;

/** 来源描述以实际文件为单位；组合场景不冒充可导出的组件。 */
export function implementationFor(entry: CatalogEntry) {
  const group = groups.find(([, names]) =>
    (names as readonly string[]).includes(entry.name),
  );
  if (!group) return undefined;
  const [path] = group;
  const source = Object.entries(sourceFiles).find(([file]) =>
    file.endsWith(`/src/${path}`),
  )?.[1];
  const upstreamFile = upstreamFiles[path];
  const aiElement = aiElementSources[path];
  const adapted = Boolean(upstreamFile) || Boolean(aiElement);
  return {
    path: `packages/ui/src/${path}`,
    source,
    origin: adapted ? "官方源码改编" : "Archer 本地实现",
    explanation: adapted
      ? "保留官方组合结构及 Base UI 原语，样式已改为 Archer CSS，因此不等于官方 Rhea 外观。"
      : "由 Archer 维护的实现或业务组合，不标记为官方源码复制。参考范围见 THIRD_PARTY.md。",
    upstream: aiElement ?? (upstreamFile
      ? `https://github.com/shadcn-ui/ui/blob/${upstreamRevision}/apps/v4/registry/bases/base/ui/${upstreamFile}`
      : undefined),
  };
}
