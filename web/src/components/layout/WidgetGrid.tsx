import { useMemo } from 'react';
import { useDashboard } from '../../context/DashboardContext';
import { useLayout } from '../../context/LayoutContext';
import type { LayoutWidget, LiveMatch } from '../../api/types';
import { WIDGET_REGISTRY, UnknownWidget } from '../widgets/registry';
import { EmptyState } from '../ui/States';

/**
 * Widgets a mostrar, em ordem, já filtrados.
 *
 * "Tempo Real" só existe enquanto há jogo em andamento. E com o jogo em campo
 * o "Próximo Jogo" some de propósito: o que está rolando é o tempo real, e o
 * próximo só passa a valer depois do apito final.
 */
export function visibleWidgets(
  widgets: LayoutWidget[] | null | undefined,
  liveMatch: LiveMatch | null | undefined,
): LayoutWidget[] {
  return (widgets ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .filter((widget) => widget.visible)
    .filter((widget) => widget.type !== 'live_match' || Boolean(liveMatch))
    .filter((widget) => widget.type !== 'next_match' || !liveMatch);
}

/**
 * Grade de 4 colunas que vai a 2 no tablet e a 1 no celular.
 *
 * Os `max-[...]` vêm em ordem decrescente de largura de propósito: no celular
 * os dois batem e o mais estreito tem de vencer.
 */
export const WIDGET_GRID =
  'grid grid-cols-[repeat(4,minmax(0,1fr))] items-start gap-[18px] ' +
  'max-[1000px]:grid-cols-[repeat(2,minmax(0,1fr))] ' +
  'max-[620px]:grid-cols-1';

/**
 * Quantas colunas um widget ocupa, por tamanho.
 *
 * `lg` e `full` são o mesmo span no desktop; o tablet e o celular derrubam
 * ambos para a largura inteira — um widget largo com meia tela vira lixo.
 */
export const WIDGET_SPAN: Record<string, string> = {
  sm: 'col-span-1 max-[620px]:col-span-full',
  md: 'col-span-2 max-[620px]:col-span-full',
  lg: 'col-span-2 max-[1000px]:col-span-full max-[620px]:col-span-full',
  full: 'col-span-full',
};

/** Envolvente de um widget na grade: `min-w-0` para o conteúdo não estourar a coluna. */
export const WIDGET_SLOT = 'min-w-0';

/**
 * Renderiza os widgets do layout em ordem, respeitando `visible` e `size`.
 * Grid responsivo: sm=1 coluna, md/lg=2 colunas, full=todas as colunas.
 */
export function WidgetGrid() {
  const { draft, config } = useLayout();
  const { data } = useDashboard();

  const widgets = useMemo(
    () => visibleWidgets(draft?.widgets, data?.live_match),
    [draft, data],
  );

  if (!data) return null;

  if (widgets.length === 0) {
    return (
      <EmptyState message="Nenhum widget visível. Ative-os em Configurações → Widgets." />
    );
  }

  return (
    <div className={WIDGET_GRID}>
      {widgets.map((widget) => {
        const Component = WIDGET_REGISTRY[widget.type];
        return (
          <section
            key={widget.id}
            data-testid="widget"
            className={`${WIDGET_SLOT} ${WIDGET_SPAN[widget.size] ?? WIDGET_SPAN.sm}`}
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
