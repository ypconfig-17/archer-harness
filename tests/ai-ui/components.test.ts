/** 组件只渲染宿主展示数据，不根据计划声明伪造任务终态。 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import {
  Plan,
  ActivityGroup,
  InteractionCard,
  TurnSummary,
  AssistantAnswer,
  InteractionRecord,
  ExecutionNotice,
  Sources,
  Source,
  InlineCitation,
  Suggestions,
  Suggestion,
  StackTrace,
  TestResults,
  Task,
  Tool,
} from '../../packages/ui/src/index';

it('计划默认折叠并显示声明比例，空计划不产生无效进度', () => {
  const html = renderToStaticMarkup(
    createElement(Plan, {
      title: '核对展示',
      steps: [{ id: 'one', text: '读取事件', status: 'completed' }],
    }),
  );
  expect(html).toContain('is-completed');
  expect(html).toContain('1/1');
  expect(html).not.toContain('open=""');
  expect(html).not.toContain('任务已完成');
  const empty = renderToStaticMarkup(createElement(Plan, { title: '空声明', steps: [] }));
  expect(empty).not.toContain('<progress');
});

it('工具组保留详情且默认折叠，人工卡片保留宿主动作', () => {
  const html = renderToStaticMarkup(
    createElement(ActivityGroup, { title: '工具活动', children: '完整参数' }),
  );
  expect(html).toContain('完整参数');
  expect(html).not.toContain('open=""');
  const card = renderToStaticMarkup(
    createElement(InteractionCard, {
      title: '需要确认',
      children: '问题',
      actions: createElement('button', {}, '继续'),
    }),
  );
  expect(card).toContain('<button>继续</button>');
});

it('终态与局部异常并存，等待状态不冒充完成', () => {
  const done = renderToStaticMarkup(
    createElement(TurnSummary, { status: 'completed', calls: 4, attention: '1 项未知结果' }),
  );
  expect(done).toContain('已完成');
  expect(done).toContain('1 项未知结果');
  const waiting = renderToStaticMarkup(createElement(TurnSummary, { status: 'waiting-approval' }));
  expect(waiting).toContain('等待授权');
  expect(waiting).not.toContain('已完成');
  expect(waiting).not.toContain('次调用');
});

it('历史交互默认折叠，答复与未知结果保留独立阅读语义', () => {
  const history = renderToStaticMarkup(
    createElement(InteractionRecord, { title: '已回答', children: '原问题和回答' }),
  );
  expect(history).toContain('原问题和回答');
  expect(history).not.toContain('open=""');
  const answer = renderToStaticMarkup(
    createElement(AssistantAnswer, { children: '结论', results: '文件入口' }),
  );
  expect(answer).toContain('aria-label="最终答复"');
  expect(answer).toContain('文件入口');
  const unknown = renderToStaticMarkup(
    createElement(ExecutionNotice, {
      kind: 'unknown',
      title: '结果未知',
      children: '请核查外部状态',
    }),
  );
  expect(unknown).toContain('data-kind="unknown"');
  expect(unknown).not.toContain('重试');
});

it('公共基础控件保留按钮类型、禁用与选择器原生语义', async () => {
  const { Button, NativeSelect, SegmentedControl, Icon } = await import('../../packages/ui/src/index');
  const button = renderToStaticMarkup(
    createElement(Button, { disabled: true, variant: 'default', children: '提交' }),
  );
  expect(button).toContain('type="button"');
  expect(button).toContain('disabled');
  expect(button).toContain('data-slot="button"');
  expect(button).toContain('cn-button-variant-default');
  expect(
    renderToStaticMarkup(
      createElement(Button, { variant: 'outline', children: '描边' }),
    ),
  ).toContain('cn-button-variant-outline');
  expect(
    renderToStaticMarkup(
      createElement(Button, { variant: 'ghost', children: '轻量' }),
    ),
  ).toContain('cn-button-variant-ghost');
  const select = renderToStaticMarkup(
    createElement(NativeSelect, {
      'aria-label': '选择',
      children: createElement('option', { value: 'a' }, '选项'),
    }),
  );
  expect(select).toContain('<select');
  expect(select).toContain('aria-label="选择"');
  const segment = renderToStaticMarkup(
    createElement(SegmentedControl, {
      label: '模式',
      value: 'a',
      options: [{ value: 'a', label: '默认' }],
      onChange() {},
    }),
  );
  expect(segment).toContain('aria-pressed="true"');
  expect(renderToStaticMarkup(createElement(Icon, { name: 'check' }))).toContain(
    'aria-hidden="true"',
  );
});

it('输入与组合卡片透传原生表单和无障碍状态', async () => {
  const { Input, Card, CardTitle, CardContent } = await import('../../packages/ui/src/index');
  const input = renderToStaticMarkup(
    createElement(Input, { required: true, disabled: true, 'aria-invalid': true, name: 'title' }),
  );
  expect(input).toContain('required');
  expect(input).toContain('disabled');
  expect(input).toContain('aria-invalid="true"');
  const card = renderToStaticMarkup(
    createElement(
      Card,
      {},
      createElement(CardTitle, {}, '标题'),
      createElement(CardContent, {}, '内容'),
    ),
  );
  expect(card).toContain('data-slot="card"');
  expect(card).toContain('data-slot="card-title"');
  expect(card).toContain('内容');
});

it('Trace 保持文本行语义，工具未知结果不会由组件改写成失败', async () => {
  const { Trace, Tool, Reasoning } = await import('../../packages/ui/src/index');
  const html = renderToStaticMarkup(
    createElement(
      Trace,
      {},
      createElement(Tool, { title: '结果未知，请核查', description: '未确认外部状态' }),
      createElement(Reasoning, { text: '', running: true }),
    ),
  );
  expect(html).toContain('data-slot="trace-line"');
  expect(html).toContain('结果未知，请核查');
  expect(html).not.toContain('data-status="error"');
  expect(html).not.toContain('<button');
  expect(html).toContain('正在思考');
});

it('文件选择保留路径身份，代码增删行保留标记且不注入 HTML', async () => {
  const { FileTree, CodeSnippet } = await import('../../packages/ui/src/index');
  const tree = renderToStaticMarkup(
    createElement(FileTree, {
      nodes: [{ type: 'file', path: 'src/a.ts', name: 'a.ts' }],
      selectedPath: 'src/a.ts',
      onSelect() {},
    }),
  );
  expect(tree).toContain('aria-current="page"');
  expect(tree).toContain('title="src/a.ts"');
  const code = renderToStaticMarkup(
    createElement(CodeSnippet, {
      title: '历史片段',
      lines: [{ text: '<script>unsafe()</script>', kind: 'added', number: 2 }],
      lineNumbers: true,
    }),
  );
  expect(code).toContain('data-variant="added"');
  expect(code).toContain('&lt;script&gt;');
  expect(code).not.toContain('<script>');
});

it('侧栏导航项是单个按钮，字段标签可关联输入', async () => {
  const { SidebarProvider, SidebarMenuButton, Field, FieldLabel, Input } = await import(
    '../../packages/ui/src/index'
  );
  const item = renderToStaticMarkup(
    createElement(
      SidebarProvider,
      {},
      createElement(SidebarMenuButton, { isActive: true }, '会话'),
    ),
  );
  // 官方菜单按钮把选中态写在自身，不再嵌套第二个按钮承载行尾动作。
  expect(item).toContain('data-slot="sidebar-menu-button"');
  // Base UI 把布尔状态渲染为空值属性。
  expect(item).toContain('data-active=""');
  expect(item.match(/<button/g)).toHaveLength(1);
  const field = renderToStaticMarkup(
    createElement(
      Field,
      {},
      createElement(FieldLabel, { htmlFor: 'url' }, '地址'),
      createElement(Input, { id: 'url', 'aria-describedby': 'url-help' }),
    ),
  );
  expect(field).toContain('for="url"');
  expect(field).toContain('aria-describedby="url-help"');
});

it('来源与行内引用只接受 http(s)，非法协议保留文字但不生成入口', () => {
  const sources = renderToStaticMarkup(
    createElement(
      Sources,
      { defaultOpen: true },
      createElement(Source, {
        index: 1,
        title: '官方文档',
        href: 'https://example.com/docs',
        description: '固定说明',
      }),
      createElement(Source, {
        index: 2,
        title: '危险协议',
        href: 'javascript:alert(1)',
      }),
      false,
    ),
  );
  expect(sources).toContain('<small>2</small>');
  expect(sources).toContain('href="https://example.com/docs"');
  expect(sources).toContain('rel="noreferrer"');
  expect(sources).toContain('官方文档');
  expect(sources).not.toContain('href="javascript:');
  expect(sources).toContain('危险协议');
  expect(renderToStaticMarkup(createElement(Sources, {}, null))).toBe('');

  const citation = renderToStaticMarkup(
    createElement(InlineCitation, {
      index: 1,
      title: '官方文档',
      href: 'https://example.com/docs',
    }),
  );
  expect(citation).toContain('href="https://example.com/docs"');
  expect(citation).toContain('aria-label="来源 1：官方文档"');
  const unsafeCitation = renderToStaticMarkup(
    createElement(InlineCitation, {
      index: 2,
      title: '危险协议',
      href: 'data:text/html,unsafe',
    }),
  );
  expect(unsafeCitation).not.toContain('href=');
  expect(unsafeCitation).toContain('[2]');
});

it('快捷建议只回调宿主，堆栈帧与测试结果只阅读传入数据', () => {
  const suggestions = renderToStaticMarkup(
    createElement(
      Suggestions,
      { label: '快捷建议' },
      createElement(Suggestion, { onClick() {}, children: '总结变更' }),
      createElement(Suggestion, { disabled: true, children: '禁用建议' }),
    ),
  );
  expect(suggestions).toContain('role="group"');
  expect(suggestions).toContain('aria-label="快捷建议"');
  expect(suggestions).toContain('type="button"');
  expect(suggestions).toContain('disabled');
  expect(suggestions).not.toContain('已发送');

  const stack = renderToStaticMarkup(
    createElement(StackTrace, {
      message: 'TypeError: 读取失败',
      defaultOpen: true,
      frames: [
        {
          id: 'first',
          functionName: 'projectTurn',
          file: 'src/a.ts',
          line: 2,
          column: 3,
        },
        { file: 'src/b.ts' },
      ],
    }),
  );
  expect(stack).toContain('TypeError: 读取失败');
  expect(stack).toContain('projectTurn');
  expect(stack).toContain('src/a.ts:2:3');
  expect(stack).toContain('src/b.ts');
  expect(stack).toContain('2 帧');
  // 唯一按钮只展开详情，堆栈帧本身不提供执行或重试动作。
  expect(stack.match(/<button/g)).toHaveLength(1);
  expect(stack).toContain('aria-expanded="true"');
  expect(
    renderToStaticMarkup(
      createElement(StackTrace, { message: '空堆栈', frames: [] }),
    ),
  ).toContain('未提供堆栈帧');

  const results = renderToStaticMarkup(
    createElement(TestResults, {
      cases: [
        {
          id: 'passed',
          name: '通过用例',
          status: 'passed',
          suite: 'tests/ai-ui',
          duration: '12ms',
        },
        {
          id: 'failed',
          name: '失败用例',
          status: 'failed',
          suite: 'tests/ai-ui',
          detail: '期望输出中不含 href。',
        },
        { id: 'skipped', name: '跳过用例', status: 'skipped' },
        { id: 'running', name: '运行用例', status: 'running' },
      ],
    }),
  );
  expect(results).toContain('1/4 通过');
  expect(results).toContain('1 失败');
  expect(results).toContain('1 跳过');
  expect(results).toContain('1 运行中');
  expect(results).toContain('tests/ai-ui');
  expect(results).toContain('期望输出中不含 href。');
  expect(results).not.toContain('任务已完成');
});

it('运行态使用旋转指示，完成态不残留动画', () => {
  const running = renderToStaticMarkup(
    createElement(Task, {
      title: '实际活动',
      steps: [{ id: 'read', title: '读取文件', status: 'running' }],
    }),
  );
  expect(running).toContain('ui-spinner');
  expect(running).toContain('aria-label="运行中"');
  expect(running).toContain('ui-collapsible-content');
  const completed = renderToStaticMarkup(
    createElement(Task, {
      title: '实际活动',
      steps: [{ id: 'read', title: '读取文件', status: 'completed' }],
    }),
  );
  expect(completed).not.toContain('ui-spinner');
  const tool = renderToStaticMarkup(
    createElement(Tool, { title: '执行类型检查', status: 'running' }),
  );
  expect(tool).toContain('ui-spinner');
  expect(tool).toContain('aria-label="运行中"');
});

it('图片附件提供独立键盘预览入口，普通文件不提供图片预览', async () => {
  const { PromptInput, PromptInputAttachment } = await import('../../packages/ui/src/index');
  const renderAttachment = (mediaType: string) => renderToStaticMarkup(
    createElement(PromptInput, { onSubmit: () => {} },
      createElement(PromptInputAttachment, {
        data: { id: 'image', type: 'file', mediaType, filename: 'example', url: 'data:image/png;base64,AA==' },
      }),
    ),
  );
  const image = renderAttachment('image/png');
  expect(image).toContain('aria-label="预览example"');
  expect(image).toContain('aria-label="移除example"');
  // 关闭的 Portal 弹窗不提前渲染，预览入口仍保留键盘语义。
  expect(image).not.toContain('role="dialog"');
  expect(image).not.toContain('class="ui-prompt-attachment-name"');
  const file = renderAttachment('text/plain');
  expect(file).not.toContain('aria-label="预览example"');
  expect(file).not.toContain('<dialog');
  expect(file).toContain('aria-label="移除example"');
  expect(file).toContain('class="ui-prompt-attachment-name"');
});
