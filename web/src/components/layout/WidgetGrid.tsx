import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
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
 * O vão **vertical** não está aqui de propósito: ele mora no `padding` de
 * cada célula (`WIDGET_SLOT`). É o que permite empacotar a grade pela altura
 * de cada card sem a folga ficar variando — ver `usePackedRows`.
 *
 * Os `max-[...]` vêm em ordem decrescente de largura de propósito: no celular
 * os dois batem e o mais estreito tem de vencer.
 */
export const WIDGET_GRID =
  'grid grid-cols-[repeat(4,minmax(0,1fr))] items-start gap-x-[18px] ' +
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

/**
 * Envolvente de um widget na grade.
 *
 * `min-w-0` para o conteúdo não estourar a coluna; o `pb` é o vão vertical
 * entre linhas, medido junto com o card — assim o empacotamento fecha exato.
 */
export const WIDGET_SLOT = 'min-w-0 pb-[18px]';

/** Altura de uma faixa da grade no modo empacotado, em pixels. */
const ROW_PX = 1;

/**
 * Quantas faixas um card de `height` px ocupa.
 *
 * Faixas de 1px: a altura medida vira `span N` direto. Zero (jsdom, card ainda
 * sem medida) nunca vira `span 0` — isso derrubaria a célula para baixo.
 */
export function rowSpanFor(height: number): string {
  return `span ${Math.max(1, Math.ceil(height / ROW_PX))}`;
}

/**
 * Empacota a grade pela altura de cada card, sem esticar ninguém.
 *
 * A grade linha-a-linha obriga a célula a ter a altura do card mais alto da
 * linha, e sobra papel pintado embaixo dos mais baixos. Aqui cada card ocupa
 * as faixas que a sua altura pede e o seguinte começa logo embaixo: cada card
 * flui na grade na sua própria altura.
 *
 * A ativação só acontece **depois** da primeira medida. Se algo falhar no
 * caminho, a grade continua linha-a-linha como sempre foi, em vez de virar um
 * monte de card de 1px sobreposto. E o `ResizeObserver` mantém as faixas
 * certas quando o conteúdo cresce (imagem de notícia carregando, dados novos).
 */
export function usePackedRows(ref: RefObject<HTMLDivElement | null>, version: unknown) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;

    const medir = () => {
      const cells = Array.from(root.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
      );
      const spans = cells.map((cell) => rowSpanFor(cell.getBoundingClientRect().height));
      cells.forEach((cell, index) => {
        if (cell.style.gridRowEnd !== spans[index]) cell.style.gridRowEnd = spans[index];
      });
      root.style.gridAutoRows = `${ROW_PX}px`;
    };

    medir();

    if (typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver(medir);
    Array.from(root.children).forEach((child) => {
      if (child instanceof HTMLElement) observador.observe(child);
    });
    return () => observador.disconnect();
  }, [ref, version]);
}

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

  // Sempre antes dos `return` condicionais: hook não pode pular ramo.
  const gridRef = useRef<HTMLDivElement>(null);
  usePackedRows(gridRef, widgets);

  if (!data) return null;

  if (widgets.length === 0) {
    return (
      <EmptyState message="Nenhum widget visível. Ative-os em Configurações → Widgets." />
    );
  }

  return (
    <div ref={gridRef} className={WIDGET_GRID}>
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
