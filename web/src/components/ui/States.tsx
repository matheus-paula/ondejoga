import type { ReactNode } from 'react';
import { Icon } from './Icon';

export function EmptyState({ message }: { message: string }) {
  return <p className="empty-state">{message}</p>;
}

export function SkeletonGrid() {
  return (
    <div className="widget-grid skeleton-grid" aria-hidden="true">
      <div className="widget" data-size="sm">
        <div className="skeleton skeleton--tall" />
      </div>
      <div className="widget" data-size="md">
        <div className="skeleton skeleton--tall" />
      </div>
      <div className="widget" data-size="md">
        <div className="skeleton skeleton--tall" />
      </div>
      <div className="widget" data-size="full">
        <div className="skeleton skeleton--wide" />
      </div>
    </div>
  );
}

export function LoadingLabel({ text }: { text: string }) {
  return (
    <p className="loading-label" role="status">
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
      <h2 className="error-panel-title">{title}</h2>
      <p className="error-panel-message">{message}</p>
      <button type="button" className="btn btn--primary" onClick={onRetry}>
        <Icon name="refreshCw" size={15} />
        Tentar novamente
      </button>
    </section>
  );
}
