import type { ReactNode } from 'react';

export function WidgetShell({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article className={`widget-card${className ? ` ${className}` : ''}`}>
      {title ? <h2 className="widget-title">{title}</h2> : null}
      <div className="widget-body">{children}</div>
    </article>
  );
}
