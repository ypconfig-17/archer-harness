import { useEffect, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import {
  Button,
  CodeSnippet,
  Icon,
  Input,
  SegmentedControl,
  Tabs,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@archer/ui";
import "../../../index.css";
import "./playground.css";
import { catalog, type CatalogEntry, type Category } from "./catalog";
import { coverage } from "./coverage";
import { PreviewFrame } from "./PreviewFrame";
import { Comparison } from "./reference/Comparison";
import { implementationFor } from "./implementation";

const categories: readonly Category[] = [
  "Primitives",
  "AI",
  "Renderers",
  "Patterns",
];
const tabs = ["Preview", "Code", "Usage", "Source"] as const;
type Tab = (typeof tabs)[number];
const stateLabels: Record<string, string> = {
  default: "默认",
  pending: "等待",
  running: "运行中",
  completed: "已完成",
  error: "失败",
  unknown: "未知结果",
  disabled: "禁用",
  invalid: "校验错误",
  expanded: "已展开",
  busy: "提交中",
  waiting: "等待授权",
  blocked: "受阻",
  unconfirmed: "未确认",
  assistant: "Agent",
  user: "用户",
  wrap: "折行",
  diff: "增删行",
  danger: "危险操作",
  empty: "空目录",
  collapsed: "已折叠",
  unsafe: "无效链接",
};
const readRoute = () => window.location.hash.replace(/^#\/?/, "") || "overview";
const navigate = (id: string) => {
  window.location.hash = `/${id}`;
};

/** 文档导航和示例状态只存在于本页，不参与 Archer 消息或执行状态。 */
function Explorer() {
  const [route, setRoute] = useState(readRoute);
  const [search, setSearch] = useState("");
  useEffect(() => {
    const update = () => setRoute(readRoute());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const entry = catalog.find((item) => item.id === route);
  const matches = catalog.filter((item) =>
    `${item.name} ${item.description}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <SidebarProvider
      className="explorer-provider"
      style={{ "--sidebar-width": "240px" } as CSSProperties}
    >
    <div className="component-explorer">
      <Sidebar collapsible="none" aria-label="组件目录" className="explorer-sidebar">
        <SidebarHeader>
          <strong>Archer UI</strong>
          <p>Component Explorer</p>
          <Input
            aria-label="搜索组件"
            placeholder="搜索组件…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton isActive={route === "overview"} onClick={() => navigate("overview")}>
                全部组件
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton isActive={route === "reference"} onClick={() => navigate("reference")}>
                官方 / Archer 对照
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton isActive={route === "coverage"} onClick={() => navigate("coverage")}>
                AI 覆盖清单
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          {categories.map((category) => {
            const items = matches.filter((item) => item.category === category);
            return items.length ? (
              <SidebarGroup key={category}>
                <SidebarGroupLabel>{category}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {items.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          isActive={route === item.id}
                          onClick={() => navigate(item.id)}
                        >
                          {item.name}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ) : null;
          })}
          {matches.length === 0 && <p role="status">没有匹配的组件。</p>}
        </SidebarContent>
        <SidebarFooter>
          <Button variant="secondary"
            onClick={() => {
              document.documentElement.dataset.appearance =
                document.documentElement.dataset.appearance === "dark"
                  ? "light"
                  : "dark";
            }}
          >
            <Icon name="sun" size="sm" />
            切换明暗
          </Button>
          <p>本地示例 · 不连接 Agent</p>
        </SidebarFooter>
      </Sidebar>
      <main className="explorer-main">
        <header className="explorer-toolbar">
          <span>{entry?.category ?? "Archer UI"}</span>
          <span>
            {catalog.filter((item) => item.category !== "Patterns").length}{" "}
            个组件入口 ·{" "}
            {catalog.filter((item) => item.category === "Patterns").length}{" "}
            个组合场景
          </span>
        </header>
        <div className="explorer-reader">
          {route === "overview" ? (
            <Overview search={search} />
          ) : route === "reference" ? (
            <Comparison />
          ) : route === "coverage" ? (
            <Coverage />
          ) : entry ? (
            <ComponentPage key={entry.id} entry={entry} />
          ) : (
            <section>
              <h1>未找到页面</h1>
              <p>该组件不存在，目录不会创建空占位。</p>
              <Button variant="secondary" onClick={() => navigate("ai/plan")}>查看 Plan</Button>
            </section>
          )}
        </div>
      </main>
    </div>
    </SidebarProvider>
  );
}

function ComponentPage({ entry }: { entry: CatalogEntry }) {
  const [tab, setTab] = useState<Tab>("Preview");
  const [state, setState] = useState(entry.states[0]!);
  const Demo = entry.Demo;
  const implementation = implementationFor(entry);
  return (
    <section
      className={`component-page component-document${entry.category === "Patterns" ? " component-document-workspace" : ""}`}
    >
      <div className="explorer-page-title">
        <span>{entry.category}</span>
        <h1>{entry.name}</h1>
        <p>{entry.description}</p>
        {implementation && (
          <p className="explorer-origin">
            {implementation.origin} · {implementation.path}
          </p>
        )}
      </div>
      <Tabs
        label={`${entry.name} 文档视图`}
        value={tab}
        onChange={setTab}
        items={tabs.map(value => ({ value, label: value }))}
        className="explorer-tabs"
      />
      <section
        id="panel-Preview"
        role="tabpanel"
        aria-labelledby="tab-Preview"
        hidden={tab !== "Preview"}
      >
        <PreviewFrame
          name={entry.name}
          category={entry.category}
          controls={
            <SegmentedControl
              label="示例状态"
              value={state}
              onChange={setState}
              options={entry.states.map((value) => ({
                value,
                label: stateLabels[value] ?? value,
              }))}
            />
          }
        >
          <Demo key={state} state={state} />
        </PreviewFrame>
      </section>
      <section
        id="panel-Code"
        role="tabpanel"
        aria-labelledby="tab-Code"
        hidden={tab !== "Code"}
      >
        <p>
          以下是 Preview 实际编译运行的 TSX 示例，可复制到已配置 Archer Token 的
          React 页面。
        </p>
        <CodeSnippet
          title={`${entry.name} · TSX 使用示例`}
          text={entry.source}
          lineNumbers
          wrap
        />
      </section>
      <section
        id="panel-Source"
        role="tabpanel"
        aria-labelledby="tab-Source"
        hidden={tab !== "Source"}
      >
        <h2>实际组件实现</h2>
        {implementation ? (
          <>
            <p>
              {implementation.origin} · <code>{implementation.path}</code>
            </p>
            <p>{implementation.explanation}</p>
            {implementation.upstream && (
              <a
                href={implementation.upstream}
                target="_blank"
                rel="noreferrer"
              >
                查看固定版本的上游源码
              </a>
            )}
            {implementation.source ? (
              <CodeSnippet
                title={implementation.path}
                text={implementation.source}
                lineNumbers
                wrap
              />
            ) : (
              <p>源码未加载，不以使用示例代替实现源码。</p>
            )}
          </>
        ) : (
          <>
            <p>
              此页是组合场景，不是独立导出的组件。以下是该场景实际使用的组合代码。
            </p>
            <CodeSnippet
              title={`${entry.name} · 组合源码`}
              text={entry.source}
              lineNumbers
              wrap
            />
          </>
        )}
      </section>
      <section
        id="panel-Usage"
        role="tabpanel"
        aria-labelledby="tab-Usage"
        hidden={tab !== "Usage"}
      >
        <h2>Props 与组合</h2>
        <div className="explorer-table-wrap">
          <table>
            <thead>
              <tr>
                <th>属性</th>
                <th>类型</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {entry.api.map((prop) => (
                <tr key={prop.name}>
                  <td>
                    <code>{prop.name}</code>
                  </td>
                  <td>
                    <code>{prop.type}</code>
                  </td>
                  <td>{prop.description}</td>
                </tr>
              ))}
              {!entry.api.length && (
                <tr>
                  <td colSpan={3}>
                    此页面是完整组合示例，局部状态由示例内部管理；参考 Code。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <h2>状态与交互</h2>
        <p>
          可验收状态：
          {entry.states
            .map((value) => `${stateLabels[value] ?? value} (${value})`)
            .join("、")}
          。
        </p>
        <p>
          切换状态重新初始化示例；在同一状态内，展开、选择和输入由实际组件处理。基础子组件在完整组合中演示，避免无语义的空容器。
        </p>
        <h2>边界</h2>
        <p>
          组件只负责展示与回调。事件来源、授权、任务终态及恢复仍由 Archer
          管理。计划进度表示模型声明，工具未知结果不能视为确定失败。
        </p>
        <a
          href="https://ui.shadcn.com/docs/ai-elements"
          target="_blank"
          rel="noreferrer"
        >
          参考 AI Elements 官方组合模式（新窗口）
        </a>
      </section>
    </section>
  );
}

/** 总览按组件家族聚合，子组件仍保留自己的路由与侧栏入口。 */
function Overview({ search }: { search: string }) {
  const needle = search.trim().toLowerCase();
  const matches = catalog.filter((item) =>
    `${item.name} ${item.description}`.toLowerCase().includes(needle),
  );
  const matched = new Set(matches);
  const families = new Map<string, CatalogEntry[]>();
  for (const item of catalog) {
    const key = `${item.category}:${item.group}`;
    const list = families.get(key) ?? [];
    list.push(item);
    families.set(key, list);
  }
  const visible = [...families.values()].filter((items) =>
    items.some((item) => matched.has(item)),
  );
  return (
    <section className="component-page">
      <div className="explorer-page-title">
        <span>Archer UI · Playground</span>
        <h1>全部组件与组合场景</h1>
        <p>
          按组件家族浏览真实预览、使用代码与实现源码；子组件在所属组合中展示，并保留独立入口。
          官方对照页独立保留，当前目录不将对照样板冒充全库替换。
        </p>
      </div>
      {categories.map((category) => {
        const items = visible.filter((family) => family[0]!.category === category);
        if (!items.length) return null;
        return (
          <section key={category}>
            <h2>
              {category} · {items.length}
            </h2>
            <div className="explorer-component-grid">
              {items.map((family) => {
                const primary = family[0]!;
                const implementation = implementationFor(primary);
                return (
                  <Button variant="ghost"
                    key={`${primary.category}:${primary.group}`}
                    type="button"
                    onClick={() => navigate(primary.id)}
                  >
                    <strong>{primary.group}</strong>
                    <span>{primary.description}</span>
                    <small>
                      {implementation?.origin ?? "Archer 组合场景"} ·{" "}
                      {family.length > 1
                        ? `${family.length} 个导出`
                        : `${primary.states.length} 种示例状态`}
                    </small>
                    {family.length > 1 && (
                      <small className="explorer-family-exports">
                        {family.map((item) => item.name).join(" · ")}
                      </small>
                    )}
                  </Button>
                );
              })}
            </div>
          </section>
        );
      })}
      {!visible.length && <p role="status">没有匹配的组件。</p>}
    </section>
  );
}

function Coverage() {
  return (
    <section className="component-page">
      <div className="explorer-page-title">
        <span>AI Components</span>
        <h1>AI 组件覆盖清单</h1>
        <p>
          按官方 21 个 AI
          模式对照。已实现表示组件展示和本地回调可用，不代表真实事件已接入。
        </p>
      </div>
      <div className="explorer-table-wrap">
        <table>
          <thead>
            <tr>
              <th>模式</th>
              <th>状态</th>
              <th>范围与缺口</th>
            </tr>
          </thead>
          <tbody>
            {coverage.map(([name, status, detail, id]) => (
              <tr key={name}>
                <td>
                  {id ? (
                    <Button variant="ghost"
                      type="button"
                      className="explorer-text-link"
                      onClick={() => navigate(id)}
                    >
                      {name}
                    </Button>
                  ) : (
                    name
                  )}
                </td>
                <td>
                  <span data-coverage={status}>{status}</span>
                </td>
                <td>{detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Questionnaire 为额外对照项：当前 InteractionCard
        支持宿主提供问题和动作，尚未提供通用题型与校验组件。Trace 与 CodeSnippet
        属于共享基础，也各有独立页面。
      </p>
      <p>
        Checkpoint、Subagent
        等没有当前能力支撑的模式只记录缺口，不渲染模拟恢复或子 Agent 执行按钮。
      </p>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<Explorer />);
