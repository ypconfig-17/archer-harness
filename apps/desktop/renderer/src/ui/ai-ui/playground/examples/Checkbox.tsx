import { Checkbox } from '@archer/ui';

/** 示例状态由目录提供，真实确认值仍由业务宿主拥有。 */
export default function Example({ state = 'default' }: { state?: string }) {
  return (
    <label>
      <Checkbox defaultChecked={state === 'checked'} disabled={state === 'disabled'} />
      我已核查外部状态
    </label>
  );
}
