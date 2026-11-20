/**
 * 改编自 AI Elements Prompt Input（registry.ai-sdk.dev/prompt-input，2026-11-17 获取）。
 * 保留官方组合结构、附件上下文、拖拽/粘贴/文件选择与提交状态；
 * 换成 Base UI 版 Archer 原语（DropdownMenu/Button），去掉 AI SDK 类型、nanoid、
 * Command/Tabs/语音输入依赖，本地改动见包内 THIRD_PARTY.md。
 */
"use client";

import {
  type ChangeEventHandler,
  Children,
  type ClipboardEventHandler,
  type ComponentProps,
  createContext,
  type FormEvent,
  type FormEventHandler,
  Fragment,
  type HTMLAttributes,
  type KeyboardEventHandler,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { shouldAttachPastedText } from "./prompt-input-files.js";
import { PreviewCard } from "@base-ui/react/preview-card";
import { Dialog } from "../primitives/Dialog.js";
import { Button } from "../primitives/Surface.js";
import { cn } from "../lib/cn.js";
import { Icon } from "../primitives/Icon.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../primitives/DropdownMenu.js";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "../primitives/InputGroup.js";

/** AI Elements 依赖的 FileUIPart 在本地的等价结构，不引入 AI SDK。 */
export type PromptInputFile = {
  type: "file";
  mediaType: string;
  filename?: string;
  url: string;
};

export type PromptInputStatus = "submitted" | "streaming" | "ready" | "error";

type AttachmentFile = PromptInputFile & { id: string };

export type AttachmentsContext = {
  files: AttachmentFile[];
  add: (files: File[] | FileList) => void;
  remove: (id: string) => void;
  clear: () => void;
  openFileDialog: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
};

const AttachmentsContextValue = createContext<AttachmentsContext | null>(null);

export const usePromptInputAttachments = () => {
  const ctx = useContext(AttachmentsContextValue);
  if (!ctx) {
    throw new Error("usePromptInputAttachments must be used within a PromptInput");
  }
  return ctx;
};

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export type PromptInputAttachmentProps = {
  data: AttachmentFile;
  className?: string;
};

/** 图片仅展示缩略图，文件名保留在无障碍名称与大图标题；移除入口独立。 */
export function PromptInputAttachment({ data, className }: PromptInputAttachmentProps) {
  const attachments = usePromptInputAttachments();
  const [previewOpen, setPreviewOpen] = useState(false);
  const filename = data.filename || "";
  const isImage = data.mediaType?.startsWith("image/") && Boolean(data.url);
  const label = filename || (isImage ? "图片" : "附件");
  return (
    <div className={cn("ui-prompt-attachment", className)}>
      {isImage ? (
        <>
          <PreviewCard.Root>
            <PreviewCard.Trigger
              render={<Button variant="ghost" className="ui-prompt-attachment-preview-trigger" />}
              aria-label={`预览${label}`}
              onClick={() => setPreviewOpen(true)}
            >
              <img alt={label} src={data.url} />
            </PreviewCard.Trigger>
            <PreviewCard.Portal>
              <PreviewCard.Positioner side="top" sideOffset={8} className="ui-prompt-preview-positioner">
                <PreviewCard.Popup className="ui-prompt-image-hover">
                  <img alt={label} src={data.url} />
                </PreviewCard.Popup>
              </PreviewCard.Positioner>
            </PreviewCard.Portal>
          </PreviewCard.Root>
          <Dialog
            open={previewOpen}
            onOpenChange={setPreviewOpen}
            title={label}
            size="large"
            dismissOnBackdrop
          >
            <div className="ui-prompt-image-viewer">
              <img alt={label} src={data.url} />
            </div>
          </Dialog>
        </>
      ) : (
        <>
          <span className="ui-prompt-attachment-icon"><Icon name="paperclip" size="xs" /></span>
          <span className="ui-prompt-attachment-name">{label}</span>
        </>
      )}
      <ButtonRemove id={data.id} onRemove={attachments.remove} label={label} />
    </div>
  );
}

function ButtonRemove({ id, onRemove, label }: { id: string; onRemove: (id: string) => void; label: string }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="ui-prompt-attachment-remove"
      aria-label={`移除${label}`}
      onClick={(event) => {
        event.stopPropagation();
        onRemove(id);
      }}
    >
      <Icon name="x" size="xs" />
    </Button>
  );
}

export type PromptInputAttachmentsProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  children: (attachment: AttachmentFile) => ReactNode;
};

export function PromptInputAttachments({ children, className, ...props }: PromptInputAttachmentsProps) {
  const attachments = usePromptInputAttachments();
  if (!attachments.files.length) return null;
  return (
    <div className={cn("ui-prompt-attachments", className)} {...props}>
      {attachments.files.map((file) => (
        <Fragment key={file.id}>{children(file)}</Fragment>
      ))}
    </div>
  );
}

export type PromptInputActionAddAttachmentsProps = ComponentProps<typeof DropdownMenuItem> & {
  label?: string;
};

export const PromptInputActionAddAttachments = ({
  label = "添加图片或文件",
  ...props
}: PromptInputActionAddAttachmentsProps) => {
  const attachments = usePromptInputAttachments();
  return (
    <DropdownMenuItem {...props} onClick={() => attachments.openFileDialog()}>
      <Icon name="image" size="sm" />
      {label}
    </DropdownMenuItem>
  );
};

export type PromptInputMessage = {
  text: string;
  files: PromptInputFile[];
};

export type PromptInputProps = Omit<HTMLAttributes<HTMLFormElement>, "onSubmit" | "onError"> & {
  accept?: string;
  multiple?: boolean;
  globalDrop?: boolean;
  syncHiddenInput?: boolean;
  maxFiles?: number;
  maxFileSize?: number;
  onError?: (err: { code: "max_files" | "max_file_size" | "accept"; message: string }) => void;
  onSubmit: (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => void | Promise<void>;
};

export const PromptInput = ({
  className,
  accept,
  multiple,
  globalDrop,
  syncHiddenInput,
  maxFiles,
  maxFileSize,
  onError,
  onSubmit,
  children,
  ...props
}: PromptInputProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [items, setItems] = useState<AttachmentFile[]>([]);
  const files = items;
  const filesRef = useRef(files);
  filesRef.current = files;

  const openFileDialog = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const matchesAccept = useCallback(
    (f: File) => {
      if (!accept || accept.trim() === "") return true;
      const patterns = accept.split(",").map((s) => s.trim()).filter(Boolean);
      return patterns.some((pattern) => {
        if (pattern.endsWith("/*")) return f.type.startsWith(pattern.slice(0, -1));
        if (pattern.startsWith(".")) return f.name.toLowerCase().endsWith(pattern.toLowerCase());
        return f.type === pattern;
      });
    },
    [accept],
  );

  const add = useCallback(
    async (fileList: File[] | FileList) => {
      const incoming = Array.from(fileList);
      const accepted = incoming.filter((f) => matchesAccept(f));
      if (incoming.length && accepted.length === 0) {
        onError?.({ code: "accept", message: "No files match the accepted types." });
        return;
      }
      const withinSize = (f: File) => (maxFileSize ? f.size <= maxFileSize : true);
      const sized = accepted.filter(withinSize);
      if (accepted.length > 0 && sized.length === 0) {
        onError?.({ code: "max_file_size", message: "All files exceed the maximum size." });
        return;
      }
      const validated: File[] = [];
      for (const file of sized) {
        if (file.type.startsWith("image/")) {
          validated.push(file);
          continue;
        }
        try {
          const bytes = await file.arrayBuffer();
          if (bytes.byteLength > 256 * 1024) throw new Error("Text file too large");
          const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          if (text.includes("\0")) throw new Error("Binary file");
          validated.push(new File([bytes], file.name, { type: "text/plain" }));
        } catch {
          onError?.({ code: "accept", message: "Use a UTF-8 text file up to 256 KiB." });
        }
      }
      setItems((prev) => {
        const capacity = typeof maxFiles === "number" ? Math.max(0, maxFiles - prev.length) : undefined;
        const capped = typeof capacity === "number" ? validated.slice(0, capacity) : validated;
        if (typeof capacity === "number" && validated.length > capacity) {
          onError?.({ code: "max_files", message: "Too many files. Some were not added." });
        }
        const next: AttachmentFile[] = capped.map((file) => ({
          id: newId(),
          type: "file" as const,
          url: URL.createObjectURL(file),
          mediaType: file.type,
          filename: file.name,
        }));
        return prev.concat(next);
      });
    },
    [matchesAccept, maxFiles, maxFileSize, onError],
  );

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const found = prev.find((file) => file.id === id);
      if (found?.url) URL.revokeObjectURL(found.url);
      return prev.filter((file) => file.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setItems((prev) => {
      for (const file of prev) if (file.url) URL.revokeObjectURL(file.url);
      return [];
    });
  }, []);

  useEffect(() => {
    if (!syncHiddenInput || !inputRef.current || files.length !== 0) return;
    inputRef.current.value = "";
  }, [files, syncHiddenInput]);

  useEffect(() => {
    const form = formRef.current;
    if (!form || globalDrop) return;
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
      if (e.dataTransfer?.files?.length) add(e.dataTransfer.files);
    };
    form.addEventListener("dragover", onDragOver);
    form.addEventListener("drop", onDrop);
    return () => {
      form.removeEventListener("dragover", onDragOver);
      form.removeEventListener("drop", onDrop);
    };
  }, [add, globalDrop]);

  useEffect(() => {
    if (!globalDrop) return;
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
      if (e.dataTransfer?.files?.length) add(e.dataTransfer.files);
    };
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, [add, globalDrop]);

  useEffect(
    () => () => {
      for (const f of filesRef.current) if (f.url) URL.revokeObjectURL(f.url);
    },
    [],
  );

  const handleChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    if (event.currentTarget.files) add(event.currentTarget.files);
    event.currentTarget.value = "";
  };

  const convertBlobUrlToDataUrl = async (url: string): Promise<string | null> => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  };

  const ctx = useMemo<AttachmentsContext>(
    () => ({ files, add, remove, clear, openFileDialog, fileInputRef: inputRef }),
    [files, add, remove, clear, openFileDialog],
  );

  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const text = (new FormData(form).get("message") as string) || "";
    form.reset();
    Promise.all(
      files.map(async ({ id: _id, ...item }) => {
        if (item.url?.startsWith("blob:")) {
          const dataUrl = await convertBlobUrlToDataUrl(item.url);
          return { ...item, url: dataUrl ?? item.url };
        }
        return item;
      }),
    )
      .then((convertedFiles: PromptInputFile[]) => {
        try {
          const result = onSubmit({ text, files: convertedFiles }, event);
          if (result instanceof Promise) {
            result.then(() => clear()).catch(() => {});
          } else {
            clear();
          }
        } catch {
          // 失败时保留附件，用户可重试同一请求。
        }
      })
      .catch(() => {});
  };

  return (
    <AttachmentsContextValue.Provider value={ctx}>
      <input
        accept={accept}
        aria-label="上传文件"
        className="hidden"
        multiple={multiple}
        onChange={handleChange}
        ref={inputRef}
        title="上传文件"
        type="file"
      />
      <form className={cn("w-full", className)} onSubmit={handleSubmit} ref={formRef} {...props}>
        <InputGroup className="overflow-hidden">{children}</InputGroup>
      </form>
    </AttachmentsContextValue.Provider>
  );
};

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputBody = ({ className, ...props }: PromptInputBodyProps) => (
  <div className={cn("contents", className)} {...props} />
);

export type PromptInputTextareaProps = ComponentProps<typeof InputGroupTextarea>;

export const PromptInputTextarea = ({
  onChange,
  className,
  placeholder = "告诉我你想做什么…",
  ...props
}: PromptInputTextareaProps) => {
  const attachments = usePromptInputAttachments();
  const [isComposing, setIsComposing] = useState(false);

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === "Enter") {
      if (isComposing || e.nativeEvent.isComposing) return;
      if (e.shiftKey) return;
      e.preventDefault();
      const form = e.currentTarget.form;
      const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (submitButton?.disabled) return;
      form?.requestSubmit();
    }
    if (e.key === "Backspace" && e.currentTarget.value === "" && attachments.files.length > 0) {
      e.preventDefault();
      const last = attachments.files.at(-1);
      if (last) attachments.remove(last.id);
    }
  };

  const handlePaste: ClipboardEventHandler<HTMLTextAreaElement> = (event) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      event.preventDefault();
      attachments.add(files);
      return;
    }
    const text = event.clipboardData.getData("text/plain");
    // 长粘贴转换成真实文本附件，保留原文，不覆盖已输入的任务说明。
    if (shouldAttachPastedText(text)) {
      event.preventDefault();
      attachments.add([new File([text], "pasted-text.txt", { type: "text/plain" })]);
    }
  };

  return (
    <InputGroupTextarea
      className={cn("field-sizing-content max-h-48 min-h-16", className)}
      name="message"
      onCompositionEnd={() => setIsComposing(false)}
      onCompositionStart={() => setIsComposing(true)}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      placeholder={placeholder}
      {...props}
      onChange={onChange as ChangeEventHandler<HTMLTextAreaElement>}
    />
  );
};

export type PromptInputHeaderProps = Omit<ComponentProps<typeof InputGroupAddon>, "align">;

export const PromptInputHeader = ({ className, ...props }: PromptInputHeaderProps) => (
  <InputGroupAddon
    align="block-start"
    className={cn("order-first flex-wrap gap-1", className)}
    {...props}
  />
);

export type PromptInputFooterProps = Omit<ComponentProps<typeof InputGroupAddon>, "align">;

export const PromptInputFooter = ({ className, ...props }: PromptInputFooterProps) => (
  <InputGroupAddon align="block-end" className={cn("justify-between gap-1", className)} {...props} />
);

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTools = ({ className, ...props }: PromptInputToolsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props} />
);

export type PromptInputButtonProps = ComponentProps<typeof InputGroupButton>;

export const PromptInputButton = ({
  variant = "ghost",
  className,
  size,
  ...props
}: PromptInputButtonProps) => {
  const newSize = size ?? (Children.count(props.children) > 1 ? "sm" : "icon-sm");
  return (
    <InputGroupButton
      className={cn(className)}
      size={newSize}
      type="button"
      variant={variant}
      {...props}
    />
  );
};

export type PromptInputActionMenuProps = ComponentProps<typeof DropdownMenu>;
export const PromptInputActionMenu = (props: PromptInputActionMenuProps) => <DropdownMenu {...props} />;

export type PromptInputActionMenuTriggerProps = PromptInputButtonProps;

export const PromptInputActionMenuTrigger = ({
  className,
  children,
  ...props
}: PromptInputActionMenuTriggerProps) => (
  <DropdownMenuTrigger
    render={
      <PromptInputButton className={className} aria-label="添加附件" {...props}>
        {children ?? <Icon name="plus" size="sm" />}
      </PromptInputButton>
    }
  />
);

export type PromptInputActionMenuContentProps = ComponentProps<typeof DropdownMenuContent>;
export const PromptInputActionMenuContent = ({
  className,
  ...props
}: PromptInputActionMenuContentProps) => (
  <DropdownMenuContent align="start" side="top" className={cn(className)} {...props} />
);

export type PromptInputActionMenuItemProps = ComponentProps<typeof DropdownMenuItem>;
export const PromptInputActionMenuItem = ({ className, ...props }: PromptInputActionMenuItemProps) => (
  <DropdownMenuItem className={cn(className)} {...props} />
);

export type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton> & {
  status?: PromptInputStatus;
};

export const PromptInputSubmit = ({
  className,
  variant = "default",
  size = "icon-sm",
  status,
  children,
  ...props
}: PromptInputSubmitProps) => {
  let glyph: ReactNode = <Icon name="arrow-up" size="sm" />;
  if (status === "submitted") glyph = <Icon name="clock" size="sm" />;
  else if (status === "streaming") glyph = <Icon name="stop" size="sm" />;
  else if (status === "error") glyph = <Icon name="refresh" size="sm" />;
  return (
    <InputGroupButton
      aria-label="发送"
      className={cn(className)}
      size={size}
      type="submit"
      variant={variant}
      {...props}
    >
      {children ?? glyph}
    </InputGroupButton>
  );
};
