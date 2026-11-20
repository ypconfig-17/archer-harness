import { Collapsible, CollapsibleTrigger, CollapsibleContent, Button } from '@archer/ui';

/** 可复制示例只操作本地展示，不访问业务服务。 */
export default function Example({ state = 'default' }: { state?: string }) {
  return (
    <Collapsible defaultOpen={state === 'expanded'}>
      <CollapsibleTrigger render={<Button variant="secondary" />}>查看说明</CollapsibleTrigger>
      <CollapsibleContent keepMounted>
        <p>使用 Base UI 折叠原语。收起时保留挂载。</p>
      </CollapsibleContent>
    </Collapsible>
  );
}
