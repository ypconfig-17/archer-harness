/** 运行态只表达正在进行，不表示已经完成或成功。 */
export function Spinner({
  size = 'sm',
  label,
  className = '',
}: {
  size?: 'xs' | 'sm' | 'md';
  /** 独立出现时提供可读状态；旁边已有状态文字时省略。 */
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={`ui-spinner is-${size} ${className}`.trim()}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
