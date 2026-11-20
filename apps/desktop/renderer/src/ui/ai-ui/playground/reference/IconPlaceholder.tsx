import {
  CaretRightIcon,
  CaretDownIcon,
  CaretUpIcon,
  CheckIcon,
  XIcon,
  CopyIcon,
  type IconProps,
} from "@phosphor-icons/react";

const icons = {
  CaretRightIcon,
  CaretDownIcon,
  CaretUpIcon,
  CheckIcon,
  XIcon,
  CopyIcon,
};

/** 官方源码支持的 Phosphor 图标选项；不引入第二套图标库。 */
export function IconPlaceholder({
  phosphor,
  className,
}: {
  phosphor: keyof typeof icons;
  lucide?: string;
  tabler?: string;
  hugeicons?: string;
  remixicon?: string;
  className?: string;
} & Pick<IconProps, "className">) {
  const Component = icons[phosphor];
  return (
    <Component weight="regular" className={className} aria-hidden="true" />
  );
}
