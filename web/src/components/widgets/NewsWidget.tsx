import { useState } from 'react';
import { WidgetShell } from './WidgetShell';
import { EmptyState } from '../ui/States';
import { relativeTime } from '../../lib/format';
import { optNumber } from '../../lib/widgetOptions';
import type { WidgetProps } from './types';

/**
 * Miniatura da notícia: se a imagem falhar (link morto, CDN fora do ar),
 * cai para o placeholder em vez de deixar um buraco.
 */
function NewsThumb({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || !src) {
    return <span className="news-thumb news-thumb--placeholder" aria-hidden="true" />;
  }
  return (
    <img
      src={src}
      alt=""
      className="news-thumb"
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
    <WidgetShell title={widget.title || 'Notícias'} className="news">
      {items.length === 0 ? (
        <EmptyState message="Nenhuma notícia no momento." />
      ) : (
        <ul className="news-list">
          {items.map((item) => {
            const meta = [item.source, relativeTime(item.published_at, config.locale)]
              .filter(Boolean)
              .join(' · ');
            return (
              <li key={item.id} className="news-item">
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="news-link">
                  <NewsThumb src={item.image ?? ''} />
                  <span className="news-text">
                    <span className="news-title">{item.title}</span>
                    {meta ? <span className="news-meta">{meta}</span> : null}
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
