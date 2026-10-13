import type { ReactNode } from 'react';

/**
 * Cartão de widget: título, corpo e a moldura comum (fundo, borda, sombra).
 *
 * O `widget` vira o atributo `data-widget` — é por ele que os testes
 * identificam qual cartão está na tela (`.widget-card.live-match` virou
 * `[data-widget="live-match"]`), já que a classe virou só utilitário.
 */
export function WidgetShell({
  title,
  children,
  widget,
}: {
  title?: string;
  children: ReactNode;
  /** Identificação nos testes, ex.: `live-match`, `standings`, `news`. */
  widget?: string;
}) {
  return (
    <article
      data-testid="widget-card"
      data-widget={widget}
      className="flex h-full flex-col gap-3 rounded-card border border-line bg-surface px-[18px] pt-4 pb-[18px] shadow-card"
    >
      {title ? <h2 className="text-base font-extrabold tracking-[-0.01em]">{title}</h2> : null}
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </article>
  );
}
