import type { ComponentProps, ReactNode } from 'react';

/** 复用官方 Field 的标签、说明、控件与错误分层；字段校验仍由表单拥有。 */
export function Field({ children, className = '', ...props }: ComponentProps<'div'>) {
  return (
    <div {...props} className={`ui-setting-field ${className}`}>
      {children}
    </div>
  );
}

export function FieldLabel(props: ComponentProps<'label'>) {
  return <label {...props} className={`ui-setting-label ${props.className ?? ''}`} />;
}

export function FieldDescription(props: ComponentProps<'p'>) {
  return <p {...props} className={`ui-setting-description ${props.className ?? ''}`} />;
}

export function FieldError({ children, ...props }: ComponentProps<'p'>) {
  return (
    <p {...props} role="alert" className={`ui-setting-error ${props.className ?? ''}`}>
      {children}
    </p>
  );
}

export function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="ui-setting-group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}
