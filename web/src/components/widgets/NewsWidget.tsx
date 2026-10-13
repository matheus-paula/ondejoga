import { useState } from 'react';
import { WidgetShell } from './WidgetShell';
import { EmptyState } from '../ui/States';
import { relativeTime } from '../../lib/format';
import { optNumber } from '../../lib/widgetOptions';
import type { WidgetProps } from './types';

/** Miniatura 64×48. Fundo e borda já vêm no estilo — placeholder ocupa o mesmo lugar. */
const THUMB =
  'h-12 w-16 flex-none rounded-lg object-cover bg-surface-2 border border-line';

/**
 * Miniatura da notícia: se a imagem falhar (link morto, CDN fora do ar),
 * cai para o placeholder em vez de deixar um buraco.
 */
function NewsThumb({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || !src) {
    return (
      <span data-testid="news-thumb" data-placeholder="" aria-hidden="true" className={`${THUMB} inline-block`} />
    );
  }
  return (
    <img
      src={src}
      alt=""
      data-testid="news-thumb"
      className={THUMB}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/** Widget "Notícias": lista com imagem, título, fonte e tempo relativo (pt-BR). */
export function NewsWidget({ widget, data, config }: WidgetProps) {
  const limit = optNumber(widget.options, 'limit', 6);
  const items = (data.news ?? []).slice(0, limit);

  return (
    <WidgetShell title={widget.title || 'Notícias'} widget="news">
      {items.length === 0 ? (
        <EmptyState message="Nenhuma notícia no momento." />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {items.map((item) => {
            const meta = [item.source, relativeTime(item.published_at, config.locale)]
              .filter(Boolean)
              .join(' · ');
            return (
              <li key={item.id} data-testid="news-item">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 rounded-ctl p-2 text-inherit no-underline transition-colors hover:bg-surface-2"
                >
                  <NewsThumb src={item.image ?? ''} />
                  <span className="flex min-w-0 flex-col gap-[3px]">
                    <span className="font-semibold leading-[1.35]">{item.title}</span>
                    {meta ? <span className="text-[0.8rem] text-muted">{meta}</span> : null}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetShell>
  );
}
