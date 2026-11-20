import { InlineCitation } from '@archer/ui';

/** 行内引用只改变展示，不读取链接或推断来源可信度。 */
export default function Example({ state = 'default' }: { state?: string }) {
  return (
    <p>
      公开答复可以携带来源编号
      <InlineCitation
        index={1}
        title="Trace · 官方组件"
        href={
          state === 'unsafe'
            ? 'javascript:alert(1)'
            : 'https://ui.shadcn.com/docs/components/base/trace'
        }
      />
      ，完整列表由宿主另行确认；无效协议仍保留编号与标题，但不提供点击入口。
    </p>
  );
}
