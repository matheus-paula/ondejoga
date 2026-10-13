import type { ReactNode } from 'react';
import type { LayoutWidget } from '../../api/types';
import { WIDGET_GRID, WIDGET_SPAN, WIDGET_SLOT, visibleWidgets } from '../layout/WidgetGrid';
import { Icon } from './Icon';

/** Forma de reserva, para quando o layout ainda não chegou: sm, md, md, full. */
const DEFAULT_SHAPE: LayoutWidget['size'][] = ['sm', 'md', 'md', 'full'];

export function EmptyState({ message }: { message: string }) {
  return <p className="text-muted px-1 py-3.5">{message}</p>;
}

/**
 * Grade vazia no formato da real, para o layout não "pular" quando chegar.
 *
 * Com o layout em mãos (falta só o dashboard) o esqueleto repete o que vai
 * aparecer, passando pelo **mesmo** `visibleWidgets` da grade — é a fonte
 * única das regras de mostrar/esconder, então os dois não podem desandar.
 * Sem layout ainda a forma final não é conhecida, e aí vale a grade padrão.
 */
export function SkeletonGrid({ widgets }: { widgets?: LayoutWidget[] | null }) {
  // Sem dados ainda não há jogo em campo: o "Tempo Real" fica de fora e o
  // "Próximo Jogo" entra, que é o que acontece na maior parte das aberturas.
  const shape = visibleWidgets(widgets, null);
  const sizes = shape.length > 0 ? shape.map((widget) => widget.size) : DEFAULT_SHAPE;

  return (
    <div className={WIDGET_GRID} aria-hidden="true">
      {sizes.map((size, index) => (
        <div
          key={index}
          data-testid="widget"
          className={`${WIDGET_SLOT} ${WIDGET_SPAN[size] ?? WIDGET_SPAN.sm}`}
          data-size={size}
        >
          <div className={`skeleton ${size === 'full' ? 'skeleton--wide' : 'skeleton--tall'}`} />
        </div>
      ))}
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
