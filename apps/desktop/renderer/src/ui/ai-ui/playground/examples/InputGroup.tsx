import { InputGroup, InputGroupAddon, InputGroupInput, Icon } from '@archer/ui';

/** 输入组只展示结构：容器承担表面与焦点环，内部字段不再自带边框。 */
export default function Example() {
  return (
    <div className="example-control">
      <InputGroup>
        <InputGroupInput aria-label="示例搜索" placeholder="搜索文件…" />
        <InputGroupAddon align="inline-end">
          <Icon name="search" size="sm" />
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
