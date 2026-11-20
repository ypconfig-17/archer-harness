import { createElement, type ComponentType } from "react";
import { FilePreview } from "./FilePreview";
import filePreviewCode from "./FilePreview.tsx?raw";
import { SettingsPreview } from "./SettingsPreview";
import settingsPreviewCode from "./SettingsPreview.tsx?raw";
import { PatternPreview, type PatternScene } from "./Patterns";
import patternCode from "./Patterns.tsx?raw";

export type Category = "Primitives" | "AI" | "Renderers" | "Patterns";
export interface PropDoc {
  name: string;
  type: string;
  description: string;
}
export interface CatalogEntry {
  id: string;
  name: string;
  /** 总览按组件家族聚合；子组件仍保留自己的入口和路由。 */
  group: string;
  category: Category;
  description: string;
  states: readonly string[];
  api: readonly PropDoc[];
  source: string;
  Demo: ComponentType<{ state?: string }>;
  exports: readonly string[];
}

// Vite 将同一示例分别编译与读取为文字，避免预览和可复制代码维护两套实现。
const demos = import.meta.glob("./examples/*.tsx", {
  eager: true,
  import: "default",
}) as Record<string, ComponentType<{ state?: string }>>;
const sources = import.meta.glob("./examples/*.tsx", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

function page(
  category: Category,
  name: string,
  description: string,
  example: string,
  states: readonly string[],
  api: readonly PropDoc[],
  group = name,
): CatalogEntry {
  const key = `./examples/${example}.tsx`;
  if (!demos[key] || !sources[key])
    throw new Error(`Missing component example: ${example}`);
  return {
    id: `${category.toLowerCase()}/${name.toLowerCase()}`,
    name,
    group,
    category,
    description,
    states,
    api,
    source: sources[key],
    Demo: demos[key],
    exports: [name],
  };
}
const native = {
  name: "原生属性",
  type: "ComponentProps",
  description: "透传对应 HTML 属性、事件和可访问性关联；见使用代码。",
};
const p = (name: string, type: string, description: string): PropDoc => ({
  name,
  type,
  description,
});
const entries: CatalogEntry[] = [];
function family(
  category: Category,
  names: string[],
  example: string,
  description: string,
  states: string[],
  api: PropDoc[],
) {
  for (const name of names)
    entries.push(
      page(category, name, description, example, states, api, names[0]!),
    );
}
family(
  "Primitives",
  ["Button"],
  "Button",
  "标准动作按钮与视觉层级。",
  ["default", "destructive", "disabled"],
  [
    native,
    p(
      "variant",
      "'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'destructive-solid' | 'link'",
      "官方视觉层级，不改变动作语义。",
    ),
    p(
      "size",
      "'xs' | 'sm' | 'default' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg'",
      "控件高度与图标尺寸。",
    ),
  ],
);
family(
  "Primitives",
  ["Input"],
  "Input",
  "受控文本输入与错误、禁用状态，通常与 Field 组合。",
  ["default", "invalid", "disabled"],
  [native, p("aria-invalid", "boolean", "错误状态由宿主校验。")],
);
family(
  "Primitives",
  [
    "InputGroup",
    "InputGroupAddon",
    "InputGroupButton",
    "InputGroupInput",
    "InputGroupText",
    "InputGroupTextarea",
  ],
  "InputGroup",
  "输入组：容器承担表面与焦点环，内部字段与动作排在同一行。",
  ["default"],
  [
    native,
    p(
      "align（Addon）",
      "'inline-start' | 'inline-end' | 'block-start' | 'block-end'",
      "动作附着在字段内侧或整行上下。",
    ),
  ],
);
family(
  "Primitives",
  ["Textarea"],
  "Textarea",
  "多行文本输入，与 Input 共享表面、焦点环和错误状态。",
  ["default", "invalid", "disabled"],
  [
    native,
    p("variant", "'default' | 'plain'", "plain 仅保留排版，供输入容器复用。"),
  ],
);
family(
  "Primitives",
  ["Switch"],
  "Switch",
  "二元偏好开关，状态完全由宿主传入。",
  ["default", "checked", "disabled"],
  [
    p("checked / onCheckedChange", "boolean / callback", "必需，受控状态。"),
    p("label", "string", "必需，可访问名称。"),
  ],
);
family(
  "Primitives",
  ["Tabs"],
  "Tabs",
  "同层视图切换，方向键移动焦点并激活，标签与面板由宿主关联。",
  ["default"],
  [
    p("label", "string", "必需，可访问标签组名。"),
    p("value / onChange", "string / callback", "必需，受控视图值。"),
    p("items", "TabItem[]", "必需：value、label；可含 icon。"),
    p(
      "tabIdPrefix / panelIdPrefix",
      "string?",
      "宿主面板需对应 id 时显式指定。",
    ),
  ],
);
family(
  "Primitives",
  ["Tooltip"],
  "Tooltip",
  "图标动作的可访问名称补充，键盘聚焦同样显示。",
  ["default"],
  [
    p("label", "string", "必需，提示文案。"),
    p("children", "ReactElement", "必需，可聚焦的触发元素。"),
    p("side", "'top' | 'bottom' | 'left' | 'right'", "浮层方向。"),
  ],
);
family(
  "Primitives",
  ["Spinner"],
  "Spinner",
  "不确定进度指示；有确定进度时必须使用进度条而不是旋转。",
  ["default", "done"],
  [
    p("size", "'xs' | 'sm'", "尺寸刻度。"),
    p("label", "string?", "提供时生成读屏状态文本。"),
  ],
);
family(
  "Primitives",
  [
    "Card",
    "CardHeader",
    "CardTitle",
    "CardDescription",
    "CardAction",
    "CardContent",
    "CardFooter",
  ],
  "Card",
  "组合表面：标题、说明、动作、正文与页脚。子组件在完整组合中演示。",
  ["default", "sm"],
  [native, p("size", "'default' | 'sm'", "整体内距；sm 更紧凑。")],
);
family(
  "Primitives",
  ["Dialog"],
  "Dialog",
  "受控模态、Esc 关闭与焦点返回。",
  ["default"],
  [
    p("open", "boolean", "必需，由宿主控制。"),
    p("onOpenChange", "(open: boolean) => void", "必需，关闭请求回调。"),
    p("title / description", "string / string?", "标题与辅助说明。"),
    p("children / actions", "ReactNode", "正文及底部动作。"),
  ],
);
family(
  "Primitives",
  ["DialogHeader"],
  "DialogHeader",
  "共享模态标题及关闭动作。",
  ["default", "disabled"],
  [
    p("title", "string", "必需，标题。"),
    p("description", "ReactNode?", "可选说明。"),
    p("onClose", "() => void", "必需，关闭请求。"),
    p("closeDisabled", "boolean?", "保存等状态禁止关闭。"),
  ],
);
family(
  "Primitives",
  ["DialogActions"],
  "Dialog",
  "在真实 Dialog 组合中展示动作区。",
  ["default"],
  [p("children", "ReactNode", "动作控件。")],
);
family(
  "Primitives",
  ["FormField"],
  "Dialog",
  "在真实 Dialog 组合中展示标签字段。",
  ["default"],
  [p("label", "string", "字段标签。")],
);
family(
  "Primitives",
  ["ConfirmDialog"],
  "ConfirmDialog",
  "取消优先的模态确认，操作只触发本地回调。",
  ["default"],
  [
    p("title / description / confirmLabel", "string", "必需的内容与确认文案。"),
    p("onConfirm / onClose", "() => void", "必需，不内置真实操作。"),
  ],
);
family(
  "Primitives",
  ["Popover"],
  "Popover",
  "有界浮层，支持 Esc 与外部点击退出。",
  ["default"],
  [
    p("label", "string", "触发按钮文案。"),
    p("children", "ReactNode", "浮层内容。"),
  ],
);
family(
  "Primitives",
  ["FloatingSurface"],
  "FloatingSurface",
  "只提供共享浮层外观，不管理开关或定位。",
  ["default"],
  [native],
);
family(
  "Primitives",
  ["Field", "FieldLabel", "FieldDescription", "FieldError", "FieldGroup"],
  "Field",
  "标签、说明、校验错误与表单分组。子组件在有效表单组合中展示。",
  ["default", "invalid"],
  [
    native,
    p(
      "htmlFor / id / aria-describedby",
      "string",
      "调用方显式关联标签、输入及说明。",
    ),
    p("title（FieldGroup）", "string", "必需，字段组标题。"),
  ],
);
family(
  "Primitives",
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
  "Select",
  "Base UI 选择器：触发器、浮层、分组与选项。",
  ["default", "disabled"],
  [
    native,
    p("value / onValueChange", "unknown / callback", "受控选中值。"),
    p("items", "{ value, label }[]", "浮层未挂载时用于显示当前标签。"),
    p("size（Trigger）", "'sm' | 'default'", "触发器高度 28px / 32px。"),
  ],
);
family(
  "Primitives",
  ["NativeSelect"],
  "NativeSelect",
  "原生 base-select 封装，仅用于依赖原生展开行为的密集表单。",
  ["default", "disabled"],
  [native, p("onChange", "ChangeEventHandler", "原生 change 事件。")],
);
family(
  "Primitives",
  [
    "DropdownMenu",
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
    "DropdownMenuPortal",
  ],
  "DropdownMenu",
  "Base UI 下拉菜单：动作、复选与单选条目。",
  ["default"],
  [
    native,
    p("open / onOpenChange", "boolean / callback", "可选受控展开。"),
    p("value / onValueChange", "string / callback", "单选组当前值。"),
    p("render（Trigger）", "ReactElement", "把触发器渲染为现有按钮。"),
  ],
);
family(
  "Primitives",
  ["SegmentedControl"],
  "SegmentedControl",
  "互斥选项，使用按下态表达当前值。",
  ["default"],
  [
    p("label", "string", "必需，可访问组名。"),
    p("value / onChange", "string / callback", "必需，受控选项。"),
    p("options", "{value, label, icon?}[]", "必需，选项列表。"),
  ],
);
family(
  "Primitives",
  ["Collapsible", "CollapsibleTrigger", "CollapsibleContent"],
  "Collapsible",
  "Base UI 折叠原语，支持受控与非受控开关。",
  ["default", "expanded"],
  [
    p("open / defaultOpen", "boolean?", "受控值或初始展开值。"),
    p("onOpenChange", "callback", "受控模式需提供回调。"),
    p("keepMounted（Content）", "boolean?", "保留子项挂载，避免丢失局部选择。"),
  ],
);
family(
  "Primitives",
  [
    "Sidebar",
    "SidebarProvider",
    "SidebarInset",
    "SidebarHeader",
    "SidebarContent",
    "SidebarFooter",
    "SidebarGroup",
    "SidebarGroupLabel",
    "SidebarGroupAction",
    "SidebarGroupContent",
    "SidebarMenu",
    "SidebarMenuItem",
    "SidebarMenuButton",
    "SidebarMenuAction",
    "SidebarMenuBadge",
    "SidebarMenuSub",
    "SidebarMenuSubItem",
    "SidebarMenuSubButton",
    "SidebarTrigger",
    "useSidebar",
  ],
  "Sidebar",
  "官方 shadcn/ui Sidebar：Provider 管理折叠与移动端抽屉，组合式区块承载导航内容。",
  ["default", "collapsed"],
  [
    p(
      "open / onOpenChange（Provider）",
      "boolean? / callback",
      "受控折叠状态；未提供时由 Provider 自己维护并写入 cookie。",
    ),
    p(
      "collapsible（Sidebar）",
      "'offcanvas' | 'icon' | 'none'",
      "折叠方式；Archer 使用 icon 保留 56px 图标列。",
    ),
    p(
      "isActive（MenuButton）",
      "boolean?",
      "当前导航项；渲染为 aria-current 与 data-active。",
    ),
    p("useSidebar()", "hook", "读取 state、open、toggleSidebar 与移动端抽屉状态。"),
  ],
);
family(
  "Primitives",
  [
    "Item",
    "ItemGroup",
    "ItemMedia",
    "ItemContent",
    "ItemTitle",
    "ItemDescription",
    "ItemActions",
    "ItemSeparator",
    "ItemHeader",
    "ItemFooter",
  ],
  "Item",
  "官方行结构：媒体、标题、说明与行尾操作组成一行，整行可通过 render 渲染为按钮或链接。",
  ["default", "outline"],
  [
    p("variant", "'default' | 'outline' | 'muted'", "行表面层级。"),
    p("size", "'default' | 'sm' | 'xs'", "行内距与密度。"),
    p("render", "ReactElement?", "替换成 button / a，保留整行可点的无障碍语义。"),
  ],
);
family(
  "Primitives",
  ["RadioGroup", "RadioGroupItem", "Label"],
  "RadioGroup",
  "官方单选组：一组互斥选项共享一个值，标签与控件通过 Label 关联。",
  ["default", "disabled"],
  [
    p("value / defaultValue", "string?", "受控值或初始值。"),
    p("onValueChange", "callback", "受控模式需提供回调。"),
    p("disabled", "boolean?", "整组禁用，标签同步降透明度。"),
  ],
);
family(
  "Primitives",
  ["ResizablePanelGroup", "ResizablePanel", "ResizableHandle", "usePanelRef"],
  "Resizable",
  "分栏原语：像素或百分比约束、拖拽与键盘调整由 react-resizable-panels 提供。",
  ["default", "narrow"],
  [
    p(
      "orientation（Group）",
      "'horizontal' | 'vertical'",
      "分栏方向，默认 horizontal。",
    ),
    p(
      "defaultSize / minSize / maxSize（Panel）",
      "number | string",
      "数字按像素、字符串按百分比解释。",
    ),
    p("withHandle（Handle）", "boolean?", "显示拖拽手柄。"),
    p("onResize（Panel）", "callback", "回传 { asPercentage, inPixels }。"),
    p("usePanelRef", "hook", "取得面板引用，供宿主显式调整尺寸。"),
  ],
);
family(
  "Primitives",
  ["ScrollArea"],
  "ScrollArea",
  "统一滚动容器：Base UI 维护视口、滚动条与拇指状态，高度由宿主约束。",
  ["default", "long"],
  [
    p("children", "ReactNode", "滚动内容；根节点不写固定高度。"),
    p("className", "string?", "约束宿主尺寸与外观，不改变滚动语义。"),
  ],
);
family(
  "Primitives",
  ["Icon"],
  "Icon",
  "统一 Phosphor regular 功能图标。",
  ["default"],
  [
    p("name", "IconName", "必需，语义图标名。"),
    p("size", "'xs' | 'sm' | 'md' | 'lg'", "统一尺寸刻度。"),
  ],
);
family(
  "Primitives",
  ["RecordDisclosure", "RecordRow"],
  "Record",
  "轻量折叠记录与按钮入口。",
  ["default"],
  [native, p("summary（Disclosure）", "ReactNode", "必需，折叠标题。")],
);
family(
  "AI",
  [
    "PromptInput",
    "PromptInputBody",
    "PromptInputTextarea",
    "PromptInputHeader",
    "PromptInputFooter",
    "PromptInputTools",
    "PromptInputButton",
    "PromptInputActionMenu",
    "PromptInputActionMenuTrigger",
    "PromptInputActionMenuContent",
    "PromptInputActionMenuItem",
    "PromptInputActionAddAttachments",
    "PromptInputAttachments",
    "PromptInputAttachment",
    "PromptInputSubmit",
    "usePromptInputAttachments",
  ],
  "PromptInput",
  "官方 Prompt Input：文本、附件选择、拖拽/粘贴与提交状态。",
  ["default"],
  [
    native,
    p(
      "accept / maxFiles / maxFileSize",
      "string / number / number",
      "附件类型、数量与大小上限，超出时通过 onError 报告。",
    ),
    p(
      "onSubmit",
      "({ text, files }) => void | Promise<void>",
      "附件已转换为 data URL；Promise 拒绝时保留附件便于重试。",
    ),
    p(
      "status（Submit）",
      "'submitted' | 'streaming' | 'ready' | 'error'",
      "发送按钮的运行状态。",
    ),
  ],
);
family(
  "AI",
  ["Message"],
  "Message",
  "用户与 Agent 公开内容，不读取内部推理。",
  ["assistant", "user"],
  [
    p("role", "'user' | 'assistant'", "必需，消息角色。"),
    p("header / actions / children", "ReactNode", "头部、操作与正文。"),
  ],
);
family(
  "AI",
  ["AgentTurn", "MessageHeader", "ProgressParagraph"],
  "AgentTurn",
  "一轮公开阅读结构，身份与公开反馈由宿主提供。",
  ["default"],
  [
    p("children", "ReactNode", "正文，不由组件生成阶段。"),
    p(
      "name / time（MessageHeader）",
      "string / string?",
      "名称必需，时间可选。",
    ),
    p("icon / actions（MessageHeader）", "ReactNode?", "图标和动作插槽。"),
  ],
);
family(
  "AI",
  ["Trace"],
  "TraceTurn",
  "完整执行轨迹：问题、连续活动、展开输出与公开结论，使用同一套紧凑 Trace。",
  ["default", "running", "error"],
  [
    native,
    p(
      "density",
      "'standard' | 'compact'",
      "默认 standard；compact 使用内容宽度、就近元信息和输出引导线。",
    ),
    p("children", "ReactNode", "组合真实顺序的活动；不生成执行事实。"),
  ],
);
family(
  "AI",
  [
    "TraceLine",
    "TraceIcon",
    "TraceTitle",
    "TraceDescription",
    "TraceAction",
    "TraceCollapsible",
    "TraceCollapsibleTrigger",
    "TraceCollapsibleContent",
  ],
  "Trace",
  "统一执行行：图标、标题、说明和按需展开。辅助部件在有效 Trace 中展示。",
  ["default", "running", "error"],
  [
    native,
    p(
      "status（Line）",
      "'pending' | 'running' | 'warning' | 'error'",
      "完成行省略状态；状态文案仍须明确。",
    ),
    p(
      "open / defaultOpen / onOpenChange",
      "boolean / boolean / callback",
      "折叠控制。",
    ),
    p("keepMounted（Content）", "boolean?", "保持嵌套展开状态。"),
  ],
);
family(
  "AI",
  ["Tool"],
  "Tool",
  "工具行与输出；未知结果不被推断为失败。",
  ["completed", "running", "error", "unknown"],
  [
    p("title", "string", "必需，真实动作及状态文案。"),
    p("status", "'pending' | 'running' | 'error'", "局部视觉状态。"),
    p(
      "description / children / icon",
      "string? / ReactNode",
      "辅助信息、输出与图标。",
    ),
    p("defaultOpen", "boolean?", "初始展开；运行中的输出可默认可见。"),
  ],
);
family(
  "AI",
  ["Plan", "PlanHistory"],
  "Plan",
  "计划声明与步骤比例，不能代替执行事实。",
  ["pending", "running", "completed"],
  [
    p("title", "string", "必需，计划名称。"),
    p("steps", "PlanStepView[]", "必需：id、text、status、icon?。"),
    p("defaultOpen", "boolean?", "仅初始化，不覆盖用户展开选择。"),
    p(
      "showProgress / showStepStatus",
      "boolean?",
      "默认 true；轻量轨迹可省略进度条和重复的状态文字。",
    ),
  ],
);
family(
  "AI",
  ["Task"],
  "Task",
  "实际收到的动态活动步骤，不要求预先存在 Plan。",
  ["running", "completed", "error"],
  [
    p("title", "string", "必需，活动标题。"),
    p("steps", "TaskStep[]", "必需：id、title、status、detail?。"),
    p("defaultOpen", "boolean?", "初始开关。"),
  ],
);
family(
  "AI",
  ["Reasoning"],
  "Reasoning",
  "允许展示的文本与流式开关，不负责来源许可。",
  ["running", "completed"],
  [
    p("text", "string", "必需，仅已允许展示的内容。"),
    p("running", "boolean?", "流式默认展开，手动选择优先。"),
  ],
);
family(
  "AI",
  ["Confirmation"],
  "Confirmation",
  "待确认卡片与决定后的历史记录，不执行授权。",
  ["pending", "busy"],
  [
    p("title / children", "string / ReactNode", "必需，问题和范围。"),
    p("decision", "'approved' | 'denied' | undefined", "宿主确认的结果。"),
    p("busy", "boolean?", "阻止重复提交。"),
    p("onApprove / onDeny", "() => void", "必需，只触发回调。"),
  ],
);
family(
  "AI",
  ["Terminal"],
  "Terminal",
  "命令输出阅读与局部状态，不执行 Shell。",
  ["running", "completed", "error", "unknown"],
  [
    p("command / output", "string", "必需，命令原文和输出。"),
    p(
      "status",
      "'pending' | 'running' | 'completed' | 'error' | 'unknown'",
      "必需，由宿主声明。",
    ),
  ],
);
family(
  "AI",
  ["ActivityGroup"],
  "ActivityGroup",
  "连续区间折叠，不能跨事件边界移动调用。",
  ["default"],
  [
    p("title / meta", "string / string?", "标题与统计。"),
    p("children / icon", "ReactNode", "组内活动与图标。"),
    p("defaultOpen", "boolean?", "仅初始化展开，不覆盖用户后续选择。"),
  ],
);
family(
  "AI",
  ["InteractionCard"],
  "InteractionCard",
  "询问等独立交互表面，动作由宿主提供。",
  ["default"],
  [
    p("title", "string", "必需，交互标题。"),
    p("children / actions", "ReactNode", "正文与动作。"),
  ],
);
family(
  "AI",
  ["InteractionRecord"],
  "InteractionRecord",
  "原位折叠的已回答或已授权历史。",
  ["default"],
  [
    p("title / children", "string / ReactNode", "必需，摘要与原始记录。"),
    p("icon", "ReactNode?", "可选图标。"),
  ],
);
family(
  "AI",
  ["TurnSummary"],
  "TurnSummary",
  "全轮主状态与附加问题分别表达。",
  ["running", "waiting", "completed"],
  [
    p("status", "TurnStatus", "必需，由提交事实投影。"),
    p("calls / duration", "number? / string?", "调用次数与耗时。"),
    p("attention / actions", "ReactNode?", "附加诊断和入口。"),
  ],
);
family(
  "AI",
  ["ExecutionNotice"],
  "ExecutionNotice",
  "未知、受阻、未确认和错误分别表达。",
  ["unknown", "blocked", "unconfirmed", "error"],
  [
    p(
      "kind",
      "'unknown' | 'blocked' | 'unconfirmed' | 'error'",
      "必需，明确失败边界。",
    ),
    p("title / children", "string / ReactNode", "必需，完整说明。"),
    p("actions", "ReactNode?", "不默认提供重试。"),
  ],
);
family(
  "AI",
  ["AssistantAnswer"],
  "AssistantAnswer",
  "最终正文、结果和操作插槽。",
  ["default"],
  [
    p("children", "ReactNode", "必需，成熟 Markdown 渲染器可由宿主注入。"),
    p("results / actions", "ReactNode?", "结果与动作。"),
  ],
);
family(
  "AI",
  ["ConversationViewport"],
  "ConversationViewport",
  "跟随底部、历史阅读与回到最新。",
  ["default"],
  [
    p("children", "ReactNode", "必需，阅读内容。"),
    p("historyKey", "string?", "向前插入历史时改变，普通追加不改变。"),
  ],
);
family(
  "AI",
  ["Sources"],
  "Sources",
  "宿主确认的来源列表，不抓取链接或推断可信度。",
  ["default", "collapsed", "unsafe"],
  [
    p("title / defaultOpen", "string / boolean?", "折叠标题与初始展开。"),
    p("children", "Source", "必需，来源条目；空列表不渲染空壳。"),
    p(
      "index / title / href / description（Source）",
      "number? / string / string",
      "序号、标题、原文地址与说明。",
    ),
  ],
);
family(
  "AI",
  ["Source"],
  "Sources",
  "在 Sources 组合中展示单条来源；非法协议只保留文字。",
  ["default", "collapsed"],
  [
    p(
      "index / title / href / description",
      "number? / string / string / string?",
      "序号、标题、原文地址与说明。",
    ),
    p("href 协议", "http / https", "其他协议不生成可点击入口。"),
  ],
);
family(
  "AI",
  ["InlineCitation"],
  "InlineCitation",
  "行内来源编号，不读取链接内容。",
  ["default", "unsafe"],
  [
    p(
      "index / title / href",
      "number / string / string",
      "必需，编号、来源标题与原文地址。",
    ),
    p("href 协议", "http / https", "其他协议只保留编号与标题。"),
  ],
);
family(
  "AI",
  ["Suggestions", "Suggestion"],
  "Suggestion",
  "快捷建议只收拢文案并回调宿主，不自动提交。",
  ["default", "disabled"],
  [
    p("label（Suggestions）", "string?", "可访问组名。"),
    p(
      "onClick / disabled（Suggestion）",
      "callback / boolean?",
      "由宿主决定动作与可用条件。",
    ),
  ],
);
family(
  "AI",
  ["StackTrace"],
  "StackTrace",
  "展示宿主提供的结构化帧，不解析原始堆栈。",
  ["default", "collapsed"],
  [
    p("message", "string", "必需，已确认的错误摘要。"),
    p(
      "frames",
      "StackFrameView[]",
      "必需；file 必需，line / column / functionName 可缺省。",
    ),
    p("defaultOpen", "boolean?", "初始展开；缺失字段不补造。"),
  ],
);
family(
  "AI",
  ["TestResults"],
  "TestResults",
  "结构化用例与汇总，组件不执行测试。",
  ["default", "completed", "error"],
  [
    p("title", "string?", "阅读标题。"),
    p(
      "cases",
      "TestCaseView[]",
      "必需：id、name、status；可含 suite、duration、detail。",
    ),
    p("defaultOpen", "boolean?", "初始展开；汇总只统计传入用例。"),
  ],
);
family(
  "AI",
  ["FileTree"],
  "FileTree",
  "可折叠目录与路径选择，不读取磁盘。",
  ["default", "empty"],
  [
    p("nodes", "FileTreeNode[]", "必需，文件或目录节点。"),
    p("selectedPath / onSelect", "string? / callback", "路径身份与选择。"),
  ],
);
family(
  "Renderers",
  ["CodeBlock", "CodeBlockActions", "CodeBlockContent", "CodeBlockCopyButton",
    "CodeBlockFooter", "CodeBlockHeader", "CodeBlockLine", "CodeBlockTitle"],
  "CodeBlock",
  "官方代码外壳、标题、动作、行与页脚组合。",
  ["default", "wrap"],
  [native, p("children", "ReactNode", "通过组合 API 提供内容；复制按钮显式传入 value。")],
);
family(
  "Renderers",
  ["CodeSnippet"],
  "CodeSnippet",
  "带文件名的代码、日志与增删行阅读，不计算 Diff。",
  ["default", "wrap", "diff"],
  [
    p("title", "string", "阅读标题。"),
    p("text / lines", "string / CodeLine[]", "正文或带变更标记的行。"),
    p("lineNumbers / wrap", "boolean?", "行号与折行。"),
  ],
);
family(
  "Primitives",
  ["Checkbox"],
  "Checkbox",
  "Base UI 复选框，确认状态由宿主拥有。",
  ["default", "checked", "disabled"],
  [native, p("checked / onCheckedChange", "boolean / callback", "受控确认状态。")],
);
family(
  "Renderers",
  ["HistoricalDiff"],
  "HistoricalDiff",
  "按原始行号渲染前后差异，不推断缺失内容。",
  ["default", "trimmed", "unchanged"],
  [
    p("before / after", "string", "必需，两侧原文；行号只来自传入内容。"),
    p(
      "上下文与展开",
      "固定规则",
      "默认保留修改前后各 3 行，首次最多 160 行；可展开完整内容。",
    ),
  ],
);

for (const [scene, name] of [
  ["no-plan", "无计划执行"],
  ["running", "运行中"],
  ["completed", "已完成"],
  ["confirmation", "人工交互"],
  ["failed", "工具失败"],
  ["history", "长历史 / 多计划"],
] as const) {
  entries.push({
    id: `patterns/${scene}`,
    name,
    group: name,
    category: "Patterns",
    description: "固定场景组合验收，不连接真实 Agent。",
    states: ["default"],
    api: [p("scene", "PatternScene", "固定场景，回答只改变演示内存。")],
    source: patternCode,
    Demo: () => createElement(PatternPreview, { scene: scene as PatternScene }),
    exports: [],
  });
}
entries.push({
  id: "patterns/files",
  name: "文件检查器",
  group: "文件检查器",
  category: "Patterns",
  description: "文件树与差异阅读的完整组合。",
  states: ["default"],
  api: [],
  source: filePreviewCode,
  Demo: FilePreview,
  exports: [],
});
entries.push({
  id: "patterns/settings",
  name: "设置工作区",
  group: "设置工作区",
  category: "Patterns",
  description: "主题、表单和导航组合，只修改当前预览。",
  states: ["default"],
  api: [],
  source: settingsPreviewCode,
  Demo: SettingsPreview,
  exports: [],
});
export const catalog: readonly CatalogEntry[] = entries;
