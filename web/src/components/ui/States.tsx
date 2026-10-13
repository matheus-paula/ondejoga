import type { ReactNode } from 'react';
import { WIDGET_GRID, WIDGET_SPAN, WIDGET_SLOT } from '../layout/WidgetGrid';
import { Icon } from './Icon';

export function EmptyState({ message }: { message: string }) {
  return <p className="text-muted px-1 py-3.5">{message}</p>;
}

/** Grade vazia no formato da real, para o layout não "pular" quando chegar. */
export function SkeletonGrid() {
  return (
    <div className={WIDGET_GRID} aria-hidden="true">
      <div data-testid="widget" className={`${WIDGET_SLOT} ${WIDGET_SPAN.sm}`} data-size="sm">
        <div className="skeleton skeleton--tall" />
      </div>
      <div data-testid="widget" className={`${WIDGET_SLOT} ${WIDGET_SPAN.md}`} data-size="md">
        <div className="skeleton skeleton--tall" />
      </div>
      <div data-testid="widget" className={`${WIDGET_SLOT} ${WIDGET_SPAN.md}`} data-size="md">
        <div className="skeleton skeleton--tall" />
      </div>
      <div
        data-testid="widget"
        className={`${WIDGET_SLOT} ${WIDGET_SPAN.full}`}
        data-size="full"
      >
        <div className="skeleton skeleton--wide" />
      </div>
    </div>
  );
}

export function LoadingLabel({ text }: { text: string }) {
  return (
    <p className="text-muted px-1 py-3" role="status">
      {text}
    </p>
  );
}

interface ErrorPanelProps {
  title: string;
  message: string;
  onRetry: () => void;
}

export function ErrorPanel({ title, message, onRetry }: ErrorPanelProps): ReactNode {
  return (
    <section className="error-panel" role="alert">
      <h2 className="text-[1.1rem]">{title}</h2>
      <p className="text-muted">{message}</p>
      <button type="button" className="btn btn--primary" onClick={onRetry}>
        <Icon name="refreshCw" size={15} />
        Tentar novamente
      </button>
    </section>
  );
}
