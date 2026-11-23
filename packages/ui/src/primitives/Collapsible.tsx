/** 改编自 shadcn/ui，来源和许可证见包内 THIRD_PARTY.md。 */
import { Collapsible as Primitive } from '@base-ui/react/collapsible';

export function Collapsible(props: Primitive.Root.Props) {
  return <Primitive.Root data-slot="collapsible" {...props} />;
}

export function CollapsibleTrigger(props: Primitive.Trigger.Props) {
  return <Primitive.Trigger data-slot="collapsible-trigger" {...props} />;
}

export function CollapsibleContent(props: Primitive.Panel.Props) {
  return (
    <Primitive.Panel
      data-slot="collapsible-content"
      {...props}
      className={`ui-collapsible-content ${props.className ?? ''}`.trim()}
    />
  );
}
