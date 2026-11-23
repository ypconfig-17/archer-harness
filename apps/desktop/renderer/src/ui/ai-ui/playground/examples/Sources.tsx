import { Source, Sources } from '@archer/ui';

/** 可复制示例只展示固定来源，不抓取链接内容。 */
export default function Example({ state = 'default' }: { state?: string }) {
  return (
    <Sources defaultOpen={state !== 'collapsed'}>
      <Source
        index={1}
        title="Trace · 官方组件"
        href="https://ui.shadcn.com/docs/components/base/trace"
        description="执行行的组合结构"
      />
      <Source
        index={2}
        title="AI Elements · 模式目录"
        href="https://ui.shadcn.com/docs/ai-elements"
        description="官方 AI 组合模式"
      />
      {state === 'unsafe' && (
        <Source
          index={3}
          title="无效协议示例"
          href="javascript:alert(1)"
          description="只保留文字，不生成可点击入口"
        />
      )}
    </Sources>
  );
}
