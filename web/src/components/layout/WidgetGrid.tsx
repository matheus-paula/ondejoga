import { useMemo } from 'react';
import { useDashboard } from '../../context/DashboardContext';
import { useLayout } from '../../context/LayoutContext';
import { WIDGET_REGISTRY, UnknownWidget } from '../widgets/registry';
import { EmptyState } from '../ui/States';

/**
 * Renderiza os widgets do layout em ordem, respeitando `visible` e `size`.
 * Grid responsivo: sm=1 coluna, md/lg=2 colunas, full=todas as colunas.
 */
export function WidgetGrid() {
  const { draft, config } = useLayout();
  const { data } = useDashboard();

  const widgets = useMemo(
    () =>
      (draft?.widgets ?? [])
        .slice()
        .sort((a, b) => a.order - b.order)
        .filter((widget) => widget.visible)
        // "Tempo Real" só existe enquanto há jogo em andamento
        .filter((widget) => widget.type !== 'live_match' || Boolean(data?.live_match)),
    [draft, data],
  );

  if (!data) return null;

  if (widgets.length === 0) {
    return (
      <EmptyState message="Nenhum widget visível. Ative-os em Configurações → Widgets." />
    );
  }

  return (
    <div className="widget-grid">
      {widgets.map((widget) => {
        const Component = WIDGET_REGISTRY[widget.type];
        return (
          <section
            key={widget.id}
            className="widget"
            data-size={widget.size}
            data-type={widget.type}
            aria-label={widget.title || widget.type}
          >
            {Component ? (
              <Component widget={widget} data={data} config={config} />
            ) : (
              <UnknownWidget widget={widget} />
            )}
          </section>
        );
      })}
    </div>
  );
}
