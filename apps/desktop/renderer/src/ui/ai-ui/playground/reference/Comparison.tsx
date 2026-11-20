import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, NativeSelect, SegmentedControl } from "@archer/ui";
import type { ReferenceConfig, SampleState } from "./protocol";
import "./comparison.css";

import { archerReferenceTokens } from "./tokens";
import provenance from "./provenance.json";

/** 隔离文档防止 Desktop 的全局按钮、表单和排版规则覆盖官方样式。 */
export function Comparison() {
  const official = useRef<HTMLIFrameElement>(null);
  const archer = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<SampleState>("running");
  const [appearance, setAppearance] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.appearance === "dark" ? "dark" : "light",
  );
  const [accent, setAccent] = useState(
    document.documentElement.dataset.theme ?? "graphite-iris",
  );
  const [baseTheme, setBaseTheme] = useState(
    document.documentElement.dataset.baseTheme ?? "graphite",
  );
  useEffect(() => {
    const read = () => {
      setAppearance(
        document.documentElement.dataset.appearance === "dark"
          ? "dark"
          : "light",
      );
      setAccent(document.documentElement.dataset.theme ?? "graphite-iris");
      setBaseTheme(document.documentElement.dataset.baseTheme ?? "graphite");
    };
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-appearance", "data-theme", "data-base-theme"],
    });
    return () => observer.disconnect();
  }, []);
  const sync = useCallback(() => {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string) => style.getPropertyValue(`--${name}`).trim();
    const send = (
      node: HTMLIFrameElement | null,
      tokens: Record<string, string>,
    ) => {
      const config: ReferenceConfig = {
        type: "archer-reference-config",
        appearance,
        state,
        tokens,
      };
      node?.contentWindow?.postMessage(config, window.location.origin);
    };
    send(official.current, {});
    send(archer.current, archerReferenceTokens(read));
  }, [state, appearance, accent, baseTheme]);
  useEffect(() => {
    document.documentElement.dataset.appearance = appearance;
    document.documentElement.dataset.theme = accent;
    document.documentElement.dataset.baseTheme = baseTheme;
    sync();
    const ready = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== window.location.origin ||
        (event.source !== official.current?.contentWindow &&
          event.source !== archer.current?.contentWindow)
      )
        return;
      if (
        event.data &&
        typeof event.data === "object" &&
        "type" in event.data &&
        event.data.type === "archer-reference-ready"
      )
        sync();
    };
    window.addEventListener("message", ready);
    return () => window.removeEventListener("message", ready);
  }, [sync, appearance, accent, baseTheme]);
  return (
    <section className="reference-comparison">
      <div className="explorer-page-title">
        <span>官方源码 · 同构样板</span>
        <h1>官方基线 / Archer 适配</h1>
        <p>
          固定 Rhea + Neutral。两侧共用官方源码、配套 CSS、Phosphor
          和样例；右侧仅映射 Archer 的颜色与字体。
        </p>
      </div>
      <div className="comparison-controls">
        <SegmentedControl<SampleState>
          label="对照状态"
          value={state}
          onChange={setState}
          options={[
            { value: "running", label: "运行中" },
            { value: "completed", label: "已完成" },
            { value: "error", label: "失败" },
          ]}
        />
        <label>
          外观
          <NativeSelect
            value={appearance}
            onChange={(event) =>
              setAppearance(event.target.value as "light" | "dark")
            }
          >
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </NativeSelect>
        </label>
        <label>
          界面主题
          <NativeSelect
            value={baseTheme}
            onChange={(event) => setBaseTheme(event.target.value)}
          >
            <option value="graphite">Graphite</option>
            <option value="midnight">Midnight</option>
            <option value="slate">Slate</option>
            <option value="warm">Warm</option>
          </NativeSelect>
        </label>
        <label>
          Archer 强调色
          <NativeSelect
            value={accent}
            onChange={(event) => setAccent(event.target.value)}
          >
            <option value="graphite-iris">Graphite Iris</option>
            <option value="slate-teal">Slate Teal</option>
            <option value="carbon-amber">Carbon Amber</option>
            <option value="dusty-rose">Dusty Rose</option>
          </NativeSelect>
        </label>
        <Button onClick={sync}>同步当前主题</Button>
      </div>
      <Collapsible className="comparison-provenance">
        <CollapsibleTrigger>源码来源与本地维护范围</CollapsibleTrigger>
        <CollapsibleContent keepMounted>
        <p>
          固定样式：Rhea / Neutral。左侧保留官方色值；右侧保留造型，只映射
          Archer 的语义颜色与字体。此处不覆盖圆角、字号、行高和间距。
        </p>
        <p>
          两侧共用 Phosphor regular。Tool 和 Plan 由官方 Trace
          组合；示例与主题映射由 Archer 编写，尚未替换正式组件。
        </p>
        <ul>
          {provenance.files.map((file) => (
            <li key={file.path}>
              <a
                href={`${provenance.repository}/blob/${provenance.revision}/${file.path}`}
                target="_blank"
                rel="noreferrer"
              >
                {file.path}
              </a>
            </li>
          ))}
        </ul>
        </CollapsibleContent>
      </Collapsible>
      <div className="comparison-columns">
        <section>
          <header>
            <strong>官方 Rhea · Neutral</strong>
            <span>官方色值与组件造型</span>
          </header>
          <iframe
            ref={official}
            title="官方 Rhea 基线"
            src="./ui-reference.html?profile=official"
            onLoad={sync}
          />
        </section>
        <section>
          <header>
            <strong>Archer · Rhea 适配</strong>
            <span>保留造型 · 映射语义 Token</span>
          </header>
          <iframe
            ref={archer}
            title="Archer Rhea 适配"
            src="./ui-reference.html?profile=archer"
            onLoad={sync}
          />
        </section>
      </div>
      <p className="comparison-note">
        输入、选择、弹窗、浮层与复制均为本地真实交互。顶部状态同步，局部输入各自独立；不执行命令、不保存业务配置。该页用于选择视觉基线，尚未替换正式组件。
      </p>
    </section>
  );
}
